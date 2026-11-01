import SwiftUI

struct AgeGateView: View {
    @EnvironmentObject private var state: AppState
    @State private var confirmed = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "person.badge.shield.checkmark").font(.system(size: 56)).foregroundStyle(.indigo)
            Text("Before we start").font(.title.bold())
            Text("SoberCoach is for adults 21 and over who want to drink less or stay under a personal limit. It is not treatment and never gives medical, withdrawal or driving advice.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal)
            Toggle("I confirm I am 21 or older", isOn: $confirmed).padding(.horizontal, 32)
            Button { Task { await state.confirmAge() } } label: {
                Text("Continue").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).tint(.indigo).disabled(!confirmed).padding(.horizontal, 32)
            Button("Sign out") { Task { await state.signOut() } }.font(.footnote)
            Spacer()
            Text("If you're in crisis, call or text 988. SAMHSA Helpline: 1-800-662-4357.")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding()
        }
    }
}
