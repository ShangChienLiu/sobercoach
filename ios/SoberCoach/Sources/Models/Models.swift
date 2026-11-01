import Foundation

// MARK: - Database rows

struct Profile: Codable, Equatable {
    var userId: UUID
    var displayName: String?
    var timezone: String
    var rolloverHour: Int
    var goalType: String
    var weeklyLimit: Double
    var quietStart: Int
    var quietEnd: Int
    var isTest: Bool
    var ageConfirmed: Bool
    var apnsToken: String?
    var lastOpenedAt: Date?

    enum CodingKeys: String, CodingKey {
        case userId = "user_id", displayName = "display_name", timezone
        case rolloverHour = "rollover_hour", goalType = "goal_type", weeklyLimit = "weekly_limit"
        case quietStart = "quiet_start", quietEnd = "quiet_end", isTest = "is_test"
        case ageConfirmed = "age_confirmed", apnsToken = "apns_token", lastOpenedAt = "last_opened_at"
    }
}

struct DrinkEntry: Codable, Identifiable, Equatable {
    let id: UUID
    var occurredAt: Date
    var serviceDate: String
    var beverage: String
    var count: Double
    var volumeMl: Double?
    var abv: Double?
    var stdDrinksExact: Double?
    var stdDrinksNominal: Double
    var status: String
    var version: Int
    var source: String

    enum CodingKeys: String, CodingKey {
        case id, beverage, count, abv, status, version, source
        case occurredAt = "occurred_at", serviceDate = "service_date", volumeMl = "volume_ml"
        case stdDrinksExact = "std_drinks_exact", stdDrinksNominal = "std_drinks_nominal"
    }

    var stdDrinks: Double { stdDrinksExact ?? stdDrinksNominal }
    var isEstimate: Bool { stdDrinksExact == nil }
    var isActive: Bool { status == "active" }
}

struct CoachEvent: Codable, Identifiable, Equatable {
    let id: UUID
    var title: String
    var startsAt: Date
    var timezone: String
    var status: String

    enum CodingKeys: String, CodingKey {
        case id, title, timezone, status
        case startsAt = "starts_at"
    }
}

struct Consent: Codable, Identifiable, Equatable {
    var category: String
    var enabled: Bool
    var id: String { category }

    static let all = ["event_prep", "morning_after", "missed_log"]
    static func label(_ category: String) -> String {
        switch category {
        case "event_prep": return "Before an event"
        case "morning_after": return "Morning after"
        case "missed_log": return "Quiet days"
        default: return category
        }
    }
}

struct DailyTotal: Codable, Identifiable, Equatable {
    var serviceDate: String
    var drinksCount: Double
    var stdDrinks: Double
    var hasNominal: Bool
    var confirmedDry: Bool
    var activeEntries: Int
    var id: String { serviceDate }

    enum CodingKeys: String, CodingKey {
        case serviceDate = "service_date", drinksCount = "drinks_count", stdDrinks = "std_drinks"
        case hasNominal = "has_nominal", confirmedDry = "confirmed_dry", activeEntries = "active_entries"
    }
}

struct LedgerMessage: Codable, Identifiable, Equatable {
    let id: UUID
    var role: String
    var content: String
    var tier: String?
    var model: String?
    var routeReason: String?
    var riskFlag: Bool
    var tokensIn: Int
    var tokensCached: Int
    var tokensOut: Int
    var costUsd: Double
    var latencyMs: Int?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, role, content, tier, model
        case routeReason = "route_reason", riskFlag = "risk_flag", tokensIn = "tokens_in"
        case tokensCached = "tokens_cached", tokensOut = "tokens_out", costUsd = "cost_usd"
        case latencyMs = "latency_ms", createdAt = "created_at"
    }
}

struct ReminderLog: Codable, Identifiable, Equatable {
    let id: UUID
    var trigger: String
    var whyNow: String
    var body: String?
    var scheduledFor: Date
    var sentAt: Date?
    var status: String
    var blockReason: String?

    enum CodingKeys: String, CodingKey {
        case id, trigger, body, status
        case whyNow = "why_now", scheduledFor = "scheduled_for", sentAt = "sent_at", blockReason = "block_reason"
    }
}

// MARK: - Chat API envelope

struct ApiEnvelope<T: Decodable>: Decodable {
    let success: Bool
    let data: T?
    let error: String?
}

struct SizeChip: Codable, Equatable, Hashable {
    let label: String
    let volumeMl: Double
    let abv: Double
    enum CodingKeys: String, CodingKey { case label, volumeMl = "volume_ml", abv }
}

struct EntryCard: Codable, Equatable {
    let entryId: UUID
    let beverage: String
    let count: Double
    let serviceDate: String
    let serviceDateLabel: String
    let stdDrinks: Double
    let isEstimate: Bool
    let before: Before?
    let sizeChips: [SizeChip]?

    struct Before: Codable, Equatable {
        let count: Double
        let serviceDate: String
        enum CodingKeys: String, CodingKey { case count, serviceDate = "service_date" }
    }

    enum CodingKeys: String, CodingKey {
        case entryId = "entry_id", beverage, count, serviceDate = "service_date"
        case serviceDateLabel = "service_date_label", stdDrinks = "std_drinks", isEstimate = "is_estimate"
        case before, sizeChips = "size_chips"
    }
}

struct ClarifyOption: Codable, Equatable, Identifiable {
    let entryId: UUID
    let label: String
    var id: UUID { entryId }
    enum CodingKeys: String, CodingKey { case entryId = "entry_id", label }
}

struct Clarify: Codable, Equatable {
    let question: String
    let options: [ClarifyOption]
}

enum TodayState: Equatable {
    case noData
    case dry
    case value(Double)
}

struct ChatState: Decodable, Equatable {
    let weeklyTotal: Double
    let weeklyRemaining: Double
    let weeklyLimit: Double
    let hasNominal: Bool
    let today: TodayState
    let todayServiceDate: String
    let strongCallsToday: Int
    let strongCap: Int

    enum CodingKeys: String, CodingKey {
        case weeklyTotal = "weekly_total", weeklyRemaining = "weekly_remaining", weeklyLimit = "weekly_limit"
        case hasNominal = "has_nominal", today, todayServiceDate = "today_service_date"
        case strongCallsToday = "strong_calls_today", strongCap = "strong_cap"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        weeklyTotal = try c.decode(Double.self, forKey: .weeklyTotal)
        weeklyRemaining = try c.decode(Double.self, forKey: .weeklyRemaining)
        weeklyLimit = try c.decode(Double.self, forKey: .weeklyLimit)
        hasNominal = try c.decode(Bool.self, forKey: .hasNominal)
        todayServiceDate = try c.decode(String.self, forKey: .todayServiceDate)
        strongCallsToday = (try? c.decode(Int.self, forKey: .strongCallsToday)) ?? 0
        strongCap = (try? c.decode(Int.self, forKey: .strongCap)) ?? 10
        if let n = try? c.decode(Double.self, forKey: .today) {
            today = .value(n)
        } else if let s = try? c.decode(String.self, forKey: .today), s == "DRY" {
            today = .dry
        } else {
            today = .noData
        }
    }
}

struct ChatData: Decodable, Equatable {
    let reply: String
    let tier: String
    let model: String?
    let routeReason: String
    let card: EntryCard?
    let clarify: Clarify?
    let safety: String?
    let state: ChatState
    let costUsd: Double
    let latencyMs: Int

    enum CodingKeys: String, CodingKey {
        case reply, tier, model, card, clarify, safety, state
        case routeReason = "route_reason", costUsd = "cost_usd", latencyMs = "latency_ms"
    }
}

// MARK: - Trigger simulator

struct GateResult: Decodable, Identifiable, Equatable {
    let gate: String
    let passed: Bool
    let detail: String
    var id: String { gate }
}

struct GateTrace: Decodable, Equatable {
    let allowed: Bool
    let blockedBy: String?
    let results: [GateResult]
}

struct CandidateReport: Decodable, Identifiable, Equatable {
    let trigger: String
    let idempotencyKey: String
    let scheduledFor: String
    let whyNow: String
    let body: String
    let status: String
    let blockReason: String?
    let gateTrace: GateTrace?
    var id: String { idempotencyKey }

    enum CodingKeys: String, CodingKey {
        case trigger, body, status
        case idempotencyKey = "idempotency_key", scheduledFor = "scheduled_for", whyNow = "why_now"
        case blockReason = "block_reason", gateTrace = "gate_trace"
    }
}

struct TriggerData: Decodable, Equatable {
    let now: String
    let reports: [CandidateReport]
}
