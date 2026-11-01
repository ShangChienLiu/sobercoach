import Foundation
import Supabase

/// Structured client actions never touch a model on the server.
enum ClientAction: Encodable, Equatable {
    case quickLog(beverage: String, count: Double, volumeMl: Double?, abv: Double?)
    case undo(entryId: UUID?)
    case applySize(entryId: UUID, volumeMl: Double, abv: Double)
    case markDry(relativeDay: String)
    case chooseEntry(entryId: UUID, originalMessage: String)
    case resetTestData

    enum CodingKeys: String, CodingKey {
        case type, beverage, count, volumeMl = "volume_ml", abv, entryId = "entry_id"
        case relativeDay = "relative_day", originalMessage = "original_message"
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .quickLog(beverage, count, volumeMl, abv):
            try c.encode("quick_log", forKey: .type)
            try c.encode(beverage, forKey: .beverage)
            try c.encode(count, forKey: .count)
            try c.encodeIfPresent(volumeMl, forKey: .volumeMl)
            try c.encodeIfPresent(abv, forKey: .abv)
        case let .undo(entryId):
            try c.encode("undo", forKey: .type)
            try c.encodeIfPresent(entryId, forKey: .entryId)
        case let .applySize(entryId, volumeMl, abv):
            try c.encode("apply_size", forKey: .type)
            try c.encode(entryId, forKey: .entryId)
            try c.encode(volumeMl, forKey: .volumeMl)
            try c.encode(abv, forKey: .abv)
        case let .markDry(relativeDay):
            try c.encode("mark_dry", forKey: .type)
            try c.encode(relativeDay, forKey: .relativeDay)
        case let .chooseEntry(entryId, originalMessage):
            try c.encode("choose_entry", forKey: .type)
            try c.encode(entryId, forKey: .entryId)
            try c.encode(originalMessage, forKey: .originalMessage)
        case .resetTestData:
            try c.encode("reset_test_data", forKey: .type)
        }
    }
}

struct ChatRequest: Encodable {
    var message: String?
    var action: ClientAction?
    /// The device's timezone travels with every request; the server reads the turn in it and keeps the profile in step.
    var clientTimezone: String = TimeZone.current.identifier
    var clientNow: Date?
    var debug: Debug?

    struct Debug: Encodable { var simulateOutage: Bool
        enum CodingKeys: String, CodingKey { case simulateOutage = "simulate_outage" } }

    enum CodingKeys: String, CodingKey { case message, action, clientNow = "client_now", clientTimezone = "client_timezone", debug }
}

enum ChatAPI {
    static func send(_ request: ChatRequest) async throws -> ChatData {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            let envelope: ApiEnvelope<ChatData> = try await Supa.client.functions.invoke(
                "chat",
                options: FunctionInvokeOptions(body: request),
                decoder: decoder
            )
            guard envelope.success, let data = envelope.data else {
                throw AppError.server(envelope.error ?? "Unknown server error")
            }
            return data
        } catch let error as FunctionsError {
            if case let .httpError(_, data) = error,
               let env = try? decoder.decode(ApiEnvelope<ChatData>.self, from: data), let msg = env.error {
                throw AppError.server(msg)
            }
            throw AppError.server(error.localizedDescription)
        }
    }
}

struct TriggerRequest: Encodable {
    var simulatedNow: Date?
    var forceApns: Bool?
    var dryRun: Bool?
    enum CodingKeys: String, CodingKey { case simulatedNow = "simulated_now", forceApns = "force_apns", dryRun = "dry_run" }
}

enum TriggerAPI {
    static func evaluate(_ request: TriggerRequest) async throws -> TriggerData {
        let decoder = JSONDecoder()
        do {
            let envelope: ApiEnvelope<TriggerData> = try await Supa.client.functions.invoke(
                "evaluate-triggers",
                options: FunctionInvokeOptions(body: request),
                decoder: decoder
            )
            guard envelope.success, let data = envelope.data else {
                throw AppError.server(envelope.error ?? "Unknown server error")
            }
            return data
        } catch let error as FunctionsError {
            if case let .httpError(_, data) = error,
               let env = try? decoder.decode(ApiEnvelope<TriggerData>.self, from: data), let msg = env.error {
                throw AppError.server(msg)
            }
            throw AppError.server(error.localizedDescription)
        }
    }
}
