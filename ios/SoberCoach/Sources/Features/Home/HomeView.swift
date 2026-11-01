import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var state: AppState
    @State private var busyAction = false
    @State private var lastCard: EntryCard?

    var body: some View {
        NavigationStack {
            List {
                Section { summaryCard }
                Section("Quick log") { quickLogRow }
                if let card = lastCard, let chips = card.sizeChips, card.isEstimate {
                    Section("Size for that \(card.beverage)?") { SizeChipsRow(chips: chips) { chip in
                        await apply(.applySize(entryId: card.entryId, volumeMl: chip.volumeMl, abv: chip.abv))
                        lastCard = nil
                    } }
                }
                Section("Last 14 days") {
                    if state.entries.isEmpty {
                        Text("No entries yet. Log with the buttons above or tell the coach.").foregroundStyle(.secondary)
                    }
                    ForEach(groupedDays, id: \.date) { day in
                        DayRow(day: day, tz: state.profile?.timezone)
                        ForEach(day.entries) { entry in
                            EntryRow(entry: entry) {
                                await apply(.undo(entryId: entry.id))
                            }
                        }
                    }
                }
            }
            .navigationTitle("Today")
            .refreshable { await state.refresh() }
            .overlay { if busyAction { ProgressView().padding().background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12)) } }
        }
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading) {
                    Text("Today").font(.caption).foregroundStyle(.secondary)
                    todayText.font(.title2.bold())
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text("This week").font(.caption).foregroundStyle(.secondary)
                    weekText.font(.title2.bold())
                }
            }
            ProgressView(value: min(1, weekFraction))
                .tint(weekFraction >= 0.8 ? .orange : .indigo)
            HStack {
                Text(paceLabel).font(.footnote).foregroundStyle(.secondary)
                Spacer()
                if case .noData = state.todayState {
                    Button("Mark today dry") { Task { await apply(.markDry(relativeDay: "today")) } }.font(.footnote)
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var todayText: Text {
        switch state.todayState {
        case .noData: return Text("No data").foregroundStyle(.secondary)
        case .dry: return Text("Dry day")
        case .value(let v): return Text(formatStd(v, estimate: state.totals.first { $0.serviceDate == state.todayServiceDate }?.hasNominal ?? false))
        }
    }

    private var weekText: Text {
        let w = state.weeklyTotal
        let limit = state.profile?.weeklyLimit ?? 14
        return Text("\(formatStd(w.total, estimate: w.hasNominal)) / \(limit.clean)")
    }

    private var weekFraction: Double {
        let limit = state.profile?.weeklyLimit ?? 14
        return limit > 0 ? state.weeklyTotal.total / limit : 0
    }

    private var paceLabel: String {
        let limit = state.profile?.weeklyLimit ?? 14
        let remaining = max(0, limit - state.weeklyTotal.total)
        let est = state.weeklyTotal.hasNominal ? " (est.)" : ""
        return remaining > 0 ? "~\(remaining.clean) standard drinks left this week\(est)" : "At your weekly limit\(est)"
    }

    private var quickLogRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                QuickButton(title: "Beer", subtitle: "12 oz · 5%", icon: "mug.fill") { await apply(.quickLog(beverage: "beer", count: 1, volumeMl: 355, abv: 5)) }
                QuickButton(title: "Wine", subtitle: "5 oz · 12%", icon: "wineglass.fill") { await apply(.quickLog(beverage: "wine", count: 1, volumeMl: 148, abv: 12)) }
                QuickButton(title: "Shot", subtitle: "1.5 oz · 40%", icon: "cup.and.saucer.fill") { await apply(.quickLog(beverage: "shot", count: 1, volumeMl: 44, abv: 40)) }
                QuickButton(title: "Cocktail", subtitle: "size unknown", icon: "sparkles") { await apply(.quickLog(beverage: "cocktail", count: 1, volumeMl: nil, abv: nil)) }
                QuickButton(title: "Undo", subtitle: "last entry", icon: "arrow.uturn.backward") { await apply(.undo(entryId: nil)) }
            }
            .padding(.vertical, 4)
        }
        .listRowInsets(EdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12))
    }

    private func apply(_ action: ClientAction) async {
        busyAction = true; defer { busyAction = false }
        if let data = await state.perform(action: action) {
            lastCard = data.card
            state.toast = data.reply
        }
    }

    fileprivate struct DayGroup { let date: String; let total: DailyTotal?; let entries: [DrinkEntry] }

    fileprivate var groupedDays: [DayGroup] {
        let dates = Array(Set(state.entries.map(\.serviceDate))).sorted(by: >)
        return dates.map { d in
            DayGroup(date: d, total: state.totals.first { $0.serviceDate == d }, entries: state.entries.filter { $0.serviceDate == d })
        }
    }
}

extension HomeView {
    fileprivate struct DayRow: View {
        let day: DayGroup
        let tz: String?
        var body: some View {
            HStack {
                Text(Formatting.serviceDateLabel(day.date, tz: tz)).font(.subheadline.weight(.semibold))
                Spacer()
                if let t = day.total {
                    Text(t.confirmedDry && t.activeEntries == 0 ? "Dry" : formatStd(t.stdDrinks, estimate: t.hasNominal))
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    Text("No data").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .listRowBackground(Color(.secondarySystemBackground))
        }
    }
}

struct EntryRow: View {
    let entry: DrinkEntry
    let onUndo: () async -> Void
    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.status == "confirmed_dry" ? "Marked dry" : "\(entry.count.clean) × \(entry.beverage)")
                    .strikethrough(entry.status == "undone")
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if entry.isActive {
                Text(formatStd(entry.stdDrinks, estimate: entry.isEstimate)).font(.caption).foregroundStyle(.secondary)
                Button { Task { await onUndo() } } label: { Image(systemName: "arrow.uturn.backward.circle") }
                    .buttonStyle(.borderless).accessibilityLabel("Undo")
            } else if entry.status == "undone" {
                Text("undone").font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }
    private var subtitle: String {
        let time = entry.occurredAt.formatted(date: .omitted, time: .shortened)
        if let v = entry.volumeMl, let a = entry.abv { return "\(time) · \(Int(v)) ml · \(a.clean)%" }
        return "\(time) · size unknown"
    }
}

struct QuickButton: View {
    let title: String; let subtitle: String; let icon: String
    let action: () async -> Void
    var body: some View {
        Button { Task { await action() } } label: {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.title3)
                Text(title).font(.subheadline.weight(.semibold))
                Text(subtitle).font(.caption2).foregroundStyle(.secondary)
            }
            .frame(width: 92, height: 76)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
    }
}

struct SizeChipsRow: View {
    let chips: [SizeChip]
    let onPick: (SizeChip) async -> Void
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                ForEach(chips, id: \.self) { chip in
                    Button(chip.label) { Task { await onPick(chip) } }
                        .buttonStyle(.bordered).tint(.indigo).font(.footnote)
                }
            }
        }
    }
}

func formatStd(_ v: Double, estimate: Bool) -> String {
    estimate ? "~\(String(format: "%.1f", v)) (est.)" : String(format: "%.1f", v)
}

extension Double {
    var clean: String { self == floor(self) ? String(Int(self)) : String(format: "%.1f", self) }
}

enum Formatting {
    static func serviceDateLabel(_ iso: String, tz: String?) -> String {
        guard let d = Supa.dateOnly.date(from: iso) else { return iso }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEE, MMM d"
        return f.string(from: d)
    }
}
