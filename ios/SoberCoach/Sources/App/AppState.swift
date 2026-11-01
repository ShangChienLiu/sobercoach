import Foundation
import Supabase
import SwiftUI

/// Session, profile and the shared summary numbers every tab shows.
/// Totals come from the server; a day with no rows is NO_DATA, never zero.
@MainActor
final class AppState: ObservableObject {
    enum Phase: Equatable { case loading, signedOut, needsAgeGate, needsScreening, ready }

    @Published var phase: Phase = .loading
    @Published var profile: Profile?
    @Published var entries: [DrinkEntry] = []
    @Published var totals: [DailyTotal] = []
    @Published var events: [CoachEvent] = []
    @Published var consents: [Consent] = []
    @Published var chatState: ChatState?
    @Published var lastError: String?
    @Published var simulatedNow: Date?
    @Published var simulateOutage = false
    @Published var toast: String?
    /// "Not now" on the screening screen: skip for this launch only (USPSTF recommends screening every adult, so it returns next launch).
    @Published var screeningSkipped = false

    let repo = DataRepo()
    private var authTask: Task<Void, Never>?

    var userId: UUID? { Supa.client.auth.currentUser?.id }
    var isTest: Bool { profile?.isTest ?? false }

    func start() {
        authTask?.cancel()
        authTask = Task {
            for await (event, session) in Supa.client.auth.authStateChanges {
                switch event {
                case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
                    if session != nil { await loadAfterSignIn() } else { phase = .signedOut }
                case .signedOut, .userDeleted:
                    profile = nil; entries = []; totals = []; events = []; chatState = nil
                    phase = .signedOut
                default: break
                }
            }
        }
        PushService.shared.onStopCategory = { [weak self] category in
            await self?.stopReminders(category: category)
        }
        PushService.shared.onOpenReminder = { [weak self] id in
            if let id { try? await self?.repo.markReminderOpened(id: id) }
            await self?.refresh()
        }
    }

    func loadAfterSignIn() async {
        do {
            let p = try await repo.profile()
            profile = p
            // Follow the device: seeded or travelling accounts otherwise keep a stale timezone and every "today" is off.
            if p.timezone != TimeZone.current.identifier {
                try? await repo.updateProfile(["timezone": .string(TimeZone.current.identifier)])
                profile = (try? await repo.profile()) ?? p
            }
            if p.isTest && CommandLine.arguments.contains("--ui-test-reset") {
                try await repo.resetTestData()
            }
            phase = !p.ageConfirmed ? .needsAgeGate : (p.auditCScore == nil && !screeningSkipped) ? .needsScreening : .ready
            if phase == .ready { await refresh() }
        } catch {
            lastError = error.localizedDescription
            phase = .signedOut
        }
    }

    func finishScreening(answers: [Int]?, sex: String?, weeklyLimit: Double?) async {
        do {
            if let answers {
                var patch: [String: AnyJSON] = [
                    "audit_c_score": .integer(answers.reduce(0, +)),
                    "audit_c_answers": .array(answers.map { .integer($0) }),
                    "audit_c_at": .string(ISO8601DateFormatter().string(from: Date())),
                    "sex_for_guidelines": sex.map { .string($0) } ?? .null,
                ]
                if let weeklyLimit { patch["weekly_limit"] = .double(weeklyLimit) }
                try await repo.updateProfile(patch)
            } else {
                screeningSkipped = true
            }
            await loadAfterSignIn()
        } catch { lastError = error.localizedDescription }
    }

    func confirmAge() async {
        do {
            try await repo.updateProfile(["age_confirmed": .bool(true), "timezone": .string(TimeZone.current.identifier)])
            await loadAfterSignIn()
        } catch { lastError = error.localizedDescription }
    }

    func refresh() async {
        async let e = repo.recentEntries()
        async let t = repo.dailyTotals()
        async let ev = repo.events()
        async let c = repo.consents()
        async let p = repo.profile()
        do {
            entries = try await e
            totals = try await t
            events = try await ev
            consents = try await c
            profile = try await p
        } catch { lastError = error.localizedDescription }
    }

    // MARK: Chat / actions

    func send(message: String) async -> ChatData? {
        await perform(ChatRequest(message: message, action: nil, clientNow: simulatedNow,
                                  debug: simulateOutage ? .init(simulateOutage: true) : nil))
    }

    func perform(action: ClientAction) async -> ChatData? {
        await perform(ChatRequest(message: nil, action: action, clientNow: simulatedNow,
                                  debug: simulateOutage ? .init(simulateOutage: true) : nil))
    }

    private func perform(_ request: ChatRequest) async -> ChatData? {
        do {
            let data = try await ChatAPI.send(request)
            chatState = data.state
            await refresh()
            return data
        } catch {
            lastError = error.localizedDescription
            return nil
        }
    }

    func stopReminders(category: String) async {
        do {
            if Consent.all.contains(category) {
                try await repo.setConsent(category: category, enabled: false)
            } else {
                try await repo.setAllConsents(enabled: false)
            }
            toast = "Reminders off for \(Consent.all.contains(category) ? Consent.label(category) : "everything")."
            await refresh()
        } catch { lastError = error.localizedDescription }
    }

    func signOut() async {
        try? await Supa.client.auth.signOut()
    }

    // MARK: Derived

    var todayServiceDate: String {
        chatState?.todayServiceDate ?? Self.serviceDate(for: simulatedNow ?? Date(), tz: profile?.timezone, rollover: profile?.rolloverHour ?? 4)
    }

    var todayState: TodayState {
        if let s = chatState?.today, chatState?.todayServiceDate == todayServiceDate { return s }
        guard let t = totals.first(where: { $0.serviceDate == todayServiceDate }) else { return .noData }
        if t.confirmedDry && t.activeEntries == 0 { return .dry }
        return .value(t.stdDrinks)
    }

    var weeklyTotal: (total: Double, hasNominal: Bool, daysWithData: Int) {
        if let s = chatState { return (s.weeklyTotal, s.hasNominal, 0) }
        let anchor = todayServiceDate
        let week = totals.filter { $0.serviceDate <= anchor && Self.daysBetween($0.serviceDate, anchor) <= 6 }
        return (week.reduce(0) { $0 + $1.stdDrinks }, week.contains { $0.hasNominal }, week.count)
    }

    nonisolated static func serviceDate(for date: Date, tz: String?, rollover: Int) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: tz ?? TimeZone.current.identifier) ?? .current
        let shifted = cal.date(byAdding: .hour, value: -rollover, to: date) ?? date
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: shifted)
    }

    nonisolated static func daysBetween(_ a: String, _ b: String) -> Int {
        guard let da = Supa.dateOnly.date(from: a), let db = Supa.dateOnly.date(from: b) else { return 99 }
        return Int(db.timeIntervalSince(da) / 86400)
    }
}
