import SwiftUI

/// Once at onboarding: AUDIT-C (USPSTF 2018 screening recommendation) plus the optional field the NIAAA lines depend on.
/// The result stays on the profile, is shown in Settings, and the coach reads it but never diagnoses.
struct ScreeningView: View {
    @EnvironmentObject private var state: AppState
    @Environment(\.dismiss) private var dismiss
    var asSheet = false
    @State private var answers: [Int?] = [nil, nil, nil]
    @State private var sex: String = "unspecified"
    @State private var busy = false

    private var score: Int { answers.compactMap { $0 }.reduce(0, +) }
    private var complete: Bool { answers.allSatisfy { $0 != nil } }
    private var sexValue: String? { sex == "unspecified" ? nil : sex }
    private var thresholds: Guidelines.Thresholds { Guidelines.thresholds(sex: sexValue) }
    private var band: Guidelines.Band { Guidelines.band(score: score, sex: sexValue) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Three questions US clinicians ask every adult (AUDIT-C). They set which published lines the coach checks your week against. Nothing here is a diagnosis.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(Guidelines.questions.indices, id: \.self) { i in
                    Section(Guidelines.questions[i].text) {
                        ForEach(Guidelines.questions[i].options.indices, id: \.self) { j in
                            Button {
                                answers[i] = j
                            } label: {
                                HStack {
                                    Text(Guidelines.questions[i].options[j]).foregroundStyle(.primary)
                                    Spacer()
                                    if answers[i] == j { Image(systemName: "checkmark").foregroundStyle(.indigo) }
                                }
                            }
                            .accessibilityIdentifier("audit-q\(i + 1)-\(j)")
                        }
                    }
                }
                Section("For the NIAAA lines (optional)") {
                    Picker("Sex", selection: $sex) {
                        Text("Prefer not to say").tag("unspecified")
                        Text("Female").tag("female")
                        Text("Male").tag("male")
                    }
                    Text("The NIAAA low-risk lines differ by sex. If you skip this, the coach applies the lower lines: \(thresholds.perDay) a day and \(thresholds.perWeek) a week.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                if complete {
                    Section("Your result") {
                        Text("AUDIT-C \(score) of 12: \(band.rawValue)").font(.headline)
                        Text(Guidelines.bandText(band)).font(.footnote)
                        Text("NIAAA low-risk lines for you: no more than \(thresholds.perDay) on any day and \(thresholds.perWeek) a week.").font(.footnote)
                        Button(busy ? "Saving…" : "Use \(thresholds.perWeek) a week as my limit") { Task { await save(limit: Double(thresholds.perWeek)) } }
                            .disabled(busy).accessibilityIdentifier("screening-use-limit")
                        Button("Keep my current limit") { Task { await save(limit: nil) } }
                            .disabled(busy).accessibilityIdentifier("screening-keep-limit")
                    }
                } else if !asSheet {
                    Section {
                        Button("Not now") { Task { await state.finishScreening(answers: nil, sex: nil, weeklyLimit: nil) } }
                            .foregroundStyle(.secondary)
                    }
                }
                Section {
                    Text("Sources: NIAAA Rethinking Drinking (standard drink, low-risk and binge definitions); USPSTF 2018 recommendation on unhealthy alcohol use screening; AUDIT-C, Bush et al. 1998.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Quick check-in")
            .toolbar { if asSheet { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } } }
        }
    }

    private func save(limit: Double?) async {
        busy = true
        await state.finishScreening(answers: answers.map { $0 ?? 0 }, sex: sexValue, weeklyLimit: limit)
        busy = false
        if asSheet { dismiss() }
    }
}
