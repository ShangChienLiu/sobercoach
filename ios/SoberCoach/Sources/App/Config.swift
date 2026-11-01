import Foundation

/// Build-time configuration read from Info.plist (populated by xcconfig).
/// The app holds only the public anon key and the user's JWT; server secrets never ship.
enum AppConfig {
    static var supabaseURL: URL {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              let url = URL(string: raw), !raw.isEmpty else {
            fatalError("SUPABASE_URL missing from Info.plist. Set it in Config/Secrets.xcconfig.")
        }
        return url
    }

    static var supabaseAnonKey: String {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String, !key.isEmpty else {
            fatalError("SUPABASE_ANON_KEY missing from Info.plist. Set it in Config/Secrets.xcconfig.")
        }
        return key
    }

    static let pushCategory = "SOBERCOACH_REMINDER"
    static let stopActionId = "STOP_CATEGORY"
    static let logActionId = "OPEN_LOG"
}
