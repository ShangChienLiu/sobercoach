import SwiftUI

@main
struct SoberCoachApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .task { state.start() }
                .onOpenURL { url in
                    Task { try? await Supa.client.auth.session(from: url) }
                }
        }
    }
}
