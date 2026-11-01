import Foundation
import Supabase

/// Direct, RLS-scoped reads and the few writes the client owns (profile, consents, push token).
/// Drink entries and events are written only through the chat function's tools.
struct DataRepo {
    private var db: SupabaseClient { Supa.client }

    func profile() async throws -> Profile {
        do {
            return try await db.from("profiles").select().single().execute().value
        } catch {
            let uid = Supa.client.auth.currentUser?.id.uuidString ?? "none"
            let hasToken = Supa.client.auth.currentSession != nil
            throw AppError.server("profile load failed (user \(uid), session \(hasToken)): \(error.localizedDescription)")
        }
    }

    func updateProfile(_ patch: [String: AnyJSON]) async throws {
        guard let uid = Supa.client.auth.currentUser?.id else { throw AppError.notSignedIn }
        try await db.from("profiles").update(patch).eq("user_id", value: uid.uuidString).execute()
    }

    func recentEntries(days: Int = 14) async throws -> [DrinkEntry] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        return try await db.from("drink_entries").select()
            .gte("occurred_at", value: Supa.iso.string(from: since))
            .order("occurred_at", ascending: false)
            .limit(200)
            .execute().value
    }

    func dailyTotals(days: Int = 14) async throws -> [DailyTotal] {
        let since = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
        return try await db.from("daily_totals").select()
            .gte("service_date", value: Supa.dateOnly.string(from: since))
            .order("service_date", ascending: false)
            .execute().value
    }

    func events() async throws -> [CoachEvent] {
        try await db.from("events").select("id,title,starts_at,timezone,status")
            .eq("status", value: "active")
            .gte("starts_at", value: Supa.iso.string(from: Date().addingTimeInterval(-12 * 3600)))
            .order("starts_at")
            .execute().value
    }

    func consents() async throws -> [Consent] {
        try await db.from("consents").select("category,enabled").execute().value
    }

    func setConsent(category: String, enabled: Bool) async throws {
        guard let uid = Supa.client.auth.currentUser?.id else { throw AppError.notSignedIn }
        let row: [String: AnyJSON] = [
            "user_id": .string(uid.uuidString), "category": .string(category), "enabled": .bool(enabled),
            "updated_at": .string(Supa.iso.string(from: Date())),
        ]
        try await db.from("consents").upsert(row, onConflict: "user_id,category").execute()
    }

    func setAllConsents(enabled: Bool) async throws {
        for c in Consent.all { try await setConsent(category: c, enabled: enabled) }
    }

    func memory() async throws -> String {
        struct Row: Decodable { let summary: String }
        let row: Row = try await db.from("coach_memory").select("summary").single().execute().value
        return row.summary
    }

    func forgetMemory() async throws {
        guard let uid = Supa.client.auth.currentUser?.id else { throw AppError.notSignedIn }
        try await db.from("coach_memory").update(["summary": AnyJSON.string(""), "updated_at": .string(Supa.iso.string(from: Date()))])
            .eq("user_id", value: uid.uuidString).execute()
        try await db.from("profiles").update(["soul_profile": AnyJSON.string(""), "turns_since_dream": .integer(0)])
            .eq("user_id", value: uid.uuidString).execute()
    }

    /// The background-consolidated profile the coach reads every turn (vibe, patterns, active arc, next nudge).
    func soulProfile() async throws -> String {
        struct Row: Decodable { let soul_profile: String? }
        let row: Row = try await db.from("profiles").select("soul_profile").single().execute().value
        return row.soul_profile ?? ""
    }

    func ledger(limit: Int = 100) async throws -> [LedgerMessage] {
        try await db.from("messages").select().order("created_at", ascending: false).limit(limit).execute().value
    }

    func reminders(limit: Int = 50) async throws -> [ReminderLog] {
        try await db.from("reminder_log").select("id,trigger,why_now,body,scheduled_for,sent_at,status,block_reason")
            .order("created_at", ascending: false).limit(limit).execute().value
    }

    func markReminderOpened(id: UUID) async throws {
        try await db.from("reminder_log").update(["opened_at": AnyJSON.string(Supa.iso.string(from: Date()))])
            .eq("id", value: id.uuidString).execute()
    }

    func savePushToken(_ token: String) async throws {
        try await updateProfile(["apns_token": .string(token)])
    }

    /// Test accounts only: clears drinks and events so UI tests start from a known state.
    func resetTestData() async throws {
        guard let uid = Supa.client.auth.currentUser?.id else { throw AppError.notSignedIn }
        try await db.from("drink_entries").delete().eq("user_id", value: uid.uuidString).execute()
        try await db.from("events").delete().eq("user_id", value: uid.uuidString).execute()
    }

    func deleteAccount() async throws {
        try await Supa.client.rpc("delete_my_account").execute()
        try await Supa.client.auth.signOut()
    }
}
