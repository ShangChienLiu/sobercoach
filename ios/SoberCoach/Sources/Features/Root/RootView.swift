import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState
    @State private var showSandbox = false

    var body: some View {
        Group {
            switch state.phase {
            case .loading:
                ProgressView("Loading…").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut:
                AuthView()
            case .needsAgeGate:
                AgeGateView()
            case .ready:
                mainTabs
            }
        }
        .alert("Something went wrong", isPresented: Binding(get: { state.lastError != nil }, set: { if !$0 { state.lastError = nil } })) {
            Button("OK", role: .cancel) { state.lastError = nil }
        } message: { Text(state.lastError ?? "") }
        .overlay(alignment: .top) {
            if let toast = state.toast {
                Text(toast)
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task { try? await Task.sleep(for: .seconds(3)); withAnimation { state.toast = nil } }
            }
        }
    }

    private var mainTabs: some View {
        TabView {
            HomeView().tabItem { Label("Today", systemImage: "drop.fill") }
            ChatView().tabItem { Label("Coach", systemImage: "bubble.left.and.bubble.right.fill") }
            EventsView().tabItem { Label("Events", systemImage: "calendar") }
            SettingsView().tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(.indigo)
        .overlay(alignment: .bottomTrailing) {
            if state.isTest {
                Button { showSandbox = true } label: {
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.title3).padding(12)
                        .background(.orange.opacity(0.9), in: Circle())
                        .foregroundStyle(.white)
                        .shadow(radius: 4)
                }
                .padding(.trailing, 16).padding(.bottom, 96)
                .accessibilityLabel("Reviewer sandbox")
            }
        }
        .sheet(isPresented: $showSandbox) { SandboxView() }
    }
}
