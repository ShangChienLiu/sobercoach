import SwiftUI
import Supabase

struct AuthView: View {
    @EnvironmentObject private var state: AppState
    @State private var email = ""
    @State private var password = ""
    @State private var isSignUp = false
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SoberCoach").font(.largeTitle.bold())
                        Text("Log drinks in one line, keep a weekly limit, get a nudge only when there's a reason.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical, 8)
                }
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(isSignUp ? .newPassword : .password)
                }
                Section {
                    Button(isSignUp ? "Create account" : "Sign in") { Task { await submit() } }
                        .disabled(busy || email.isEmpty || password.count < 6)
                    Button(isSignUp ? "I already have an account" : "Create a new account") { isSignUp.toggle() }
                        .font(.footnote)
                }
                Section("Reviewer test accounts") {
                    Button("Sign in as Alex (user A)") { email = "alex@test.sobercoach.app"; password = "sobercoach-test"; Task { await submit() } }
                    Button("Sign in as Blake (user B)") { email = "blake@test.sobercoach.app"; password = "sobercoach-test"; Task { await submit() } }
                    Text("Seeded by supabase/seed.sql. Both are server-flagged test accounts with the sandbox drawer.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if let message { Section { Text(message).foregroundStyle(.red) } }
            }
            .navigationTitle("Welcome")
            .overlay { if busy { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(.ultraThinMaterial) } }
        }
    }

    private func submit() async {
        busy = true; defer { busy = false }
        message = nil
        do {
            if isSignUp {
                try await Supa.client.auth.signUp(email: email, password: password)
                if Supa.client.auth.currentSession == nil {
                    message = "Check your email to confirm, then sign in."
                }
            } else {
                try await Supa.client.auth.signIn(email: email, password: password)
            }
        } catch {
            message = error.localizedDescription
        }
    }
}
