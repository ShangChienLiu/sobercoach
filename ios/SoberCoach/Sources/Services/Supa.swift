import Foundation
import Supabase

/// One shared Supabase client. Sessions persist in the keychain via the SDK.
enum Supa {
    static let client: SupabaseClient = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            if let d = Supa.isoFractional.date(from: raw) ?? Supa.iso.date(from: raw) { return d }
            if let d = Supa.dateOnly.date(from: raw) { return d }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unparseable date \(raw)")
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return SupabaseClient(
            supabaseURL: AppConfig.supabaseURL,
            supabaseKey: AppConfig.supabaseAnonKey,
            options: .init(db: .init(encoder: encoder, decoder: decoder))
        )
    }()

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

enum AppError: LocalizedError, Equatable {
    case server(String)
    case notSignedIn
    case decoding

    var errorDescription: String? {
        switch self {
        case .server(let m): return m
        case .notSignedIn: return "You're signed out."
        case .decoding: return "The server sent something unexpected."
        }
    }
}
