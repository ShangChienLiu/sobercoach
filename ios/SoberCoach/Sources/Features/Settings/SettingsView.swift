import SwiftUI
import Supabase

struct SettingsView: View {
    @EnvironmentObject private var state: AppState
    @ObservedObject private var push = PushService.shared
    @State private var weeklyLimit: Double = 14
    @State private var rollover: Int = 4
    @State private var quietStart: Int = 22
    @State private var quietEnd: Int = 9
    @State private var confirmDelete = false
    @State private var memory: String = ""
    @State private var soulProfile: String = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Goal") {
                    Stepper("Weekly limit: \(weeklyLimit.clean) standard drinks", value: $weeklyLimit, in: 0...70, step: 1)
                        .onChange(of: weeklyLimit) { _, v in Task { try? await state.repo.updateProfile(["weekly_limit": .double(v)]); await state.refresh() } }
                    Text("A U.S. standard drink is 14 g of alcohol: 12 oz of 5% beer, 5 oz of 12% wine, 1.5 oz of 40% spirits.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Service day") {
                    Stepper("Day rolls over at \(rollover):00", value: $rollover, in: 0...12)
                        .onChange(of: rollover) { _, v in Task { try? await state.repo.updateProfile(["rollover_hour": .integer(v)]); await state.refresh() } }
                    Text("Drinks logged at 1:30 AM count toward the previous evening.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Reminders") {
                    if !push.authorized {
                        Button("Allow notifications") { Task { await push.requestPermission() } }
                    }
                    ForEach(Consent.all, id: \.self) { cat in
                        Toggle(Consent.label(cat), isOn: Binding(
                            get: { state.consents.first { $0.category == cat }?.enabled ?? true },
                            set: { on in Task { try? await state.repo.setConsent(category: cat, enabled: on); await state.refresh() } }
                        ))
                    }
                    Stepper("Quiet from \(quietStart):00", value: $quietStart, in: 0...23)
                        .onChange(of: quietStart) { _, v in Task { try? await state.repo.updateProfile(["quiet_start": .integer(v)]) } }
                    Stepper("Quiet until \(quietEnd):00", value: $quietEnd, in: 0...23)
                        .onChange(of: quietEnd) { _, v in Task { try? await state.repo.updateProfile(["quiet_end": .integer(v)]) } }
                    Text("At most one push a day and three a week. Every push has a Stop these action.").font(.caption).foregroundStyle(.secondary)
                }
                Section("What the coach remembers") {
                    if memory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Nothing yet. Tell the coach why you're cutting down, or which nights are hard, and it will keep that in mind.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ForEach(memory.split(separator: "\n").map { $0.replacingOccurrences(of: "- ", with: "") }, id: \.self) { fact in
                            Text(fact).font(.footnote)
                        }
                        Button("Forget everything", role: .destructive) {
                            Task { try? await state.repo.forgetMemory(); memory = ""; soulProfile = ""; state.toast = "Memory cleared" }
                        }
                    }
                    Text("Only facts you said yourself are kept. Nothing is inferred.").font(.caption).foregroundStyle(.secondary)
                }
                Section("What the coach has pieced together") {
                    if soulProfile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Nothing yet. Every few conversations the coach rewrites a short note about how you like to talk and which nights tend to be hard.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text(soulProfile).font(.footnote)
                    }
                    Text("Rewritten in the background from your own logs and messages. Forget everything above clears this too.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Safety") {
                    Text("If you're in crisis, call or text 988. SAMHSA National Helpline 1-800-662-4357, free and 24/7. The coach never gives withdrawal, detox or driving advice.")
                        .font(.footnote)
                }
                Section("Account") {
                    LabeledContent("Signed in as", value: Supa.client.auth.currentUser?.email ?? "—")
                    Button("Sign out") { Task { await state.signOut() } }
                    Button("Delete account and all data", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle("Settings")
            .onAppear { syncFromProfile(); Task { await reloadMemory() } }
            .refreshable { await reloadMemory() }
            // A reset from the Sandbox, or a dream pass finishing, changes both sections; reload whenever the app reports something.
            .onChange(of: state.toast) { _, _ in Task { await reloadMemory() } }
            .onChange(of: state.profile) { _, _ in syncFromProfile() }
            .confirmationDialog("Delete everything?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) { Task { try? await state.repo.deleteAccount() } }
            } message: { Text("This removes your profile, drinks, events, messages and reminders. It cannot be undone.") }
        }
    }

    private func reloadMemory() async {
        memory = (try? await state.repo.memory()) ?? ""
        soulProfile = (try? await state.repo.soulProfile()) ?? ""
    }

    private func syncFromProfile() {
        guard let p = state.profile else { return }
        weeklyLimit = p.weeklyLimit; rollover = p.rolloverHour; quietStart = p.quietStart; quietEnd = p.quietEnd
    }
}
