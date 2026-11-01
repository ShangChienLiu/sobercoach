import SwiftUI

struct ChatMessage: Identifiable, Equatable {
    enum Role { case user, coach, system }
    let id = UUID()
    let role: Role
    var text: String
    var card: EntryCard?
    var clarify: Clarify?
    var originalMessage: String?
    var safety: String?
    var meta: String?
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = [
        ChatMessage(role: .coach, text: "Tell me what you had, like \"2 beers\" or \"a glass of wine last night\". Corrections work too: \"actually it was 2\".")
    ]
    @Published var draft = ""
    @Published var sending = false

    func send(_ text: String, state: AppState) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        messages.append(ChatMessage(role: .user, text: trimmed))
        draft = ""
        sending = true; defer { sending = false }
        if let data = await state.send(message: trimmed) {
            if data.reply.isEmpty && data.card == nil && data.clarify == nil {
                messages.append(ChatMessage(role: .system, text: "", meta: "seen"))
            } else {
                messages.append(coachMessage(from: data, original: trimmed))
            }
        } else {
            messages.append(ChatMessage(role: .system, text: state.lastError ?? "Couldn't reach the coach. Nothing was written.", meta: "retry"))
        }
    }

    func perform(_ action: ClientAction, state: AppState, label: String) async {
        sending = true; defer { sending = false }
        messages.append(ChatMessage(role: .user, text: label))
        if let data = await state.perform(action: action) {
            messages.append(coachMessage(from: data, original: nil))
        }
    }

    private func coachMessage(from data: ChatData, original: String?) -> ChatMessage {
        let meta = "\(data.tier) · \(data.model?.split(separator: "/").last.map(String.init) ?? "code") · \(data.routeReason) · $\(String(format: "%.4f", data.costUsd)) · \(data.latencyMs) ms"
        return ChatMessage(role: .coach, text: data.reply, card: data.card, clarify: data.clarify, originalMessage: original, safety: data.safety, meta: meta)
    }
}

struct ChatView: View {
    @EnvironmentObject private var state: AppState
    @StateObject private var vm = ChatViewModel()
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if state.simulateOutage {
                    Button {
                        state.simulateOutage = false
                        state.toast = "Simulated outage off"
                    } label: {
                        Label("Simulated model outage is ON. Tap to turn off.", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold)).frame(maxWidth: .infinity).padding(8)
                    }
                    .buttonStyle(.plain).background(Color.orange.opacity(0.25))
                }
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(vm.messages) { msg in
                                MessageBubble(message: msg, showMeta: state.isTest) { action, label in
                                    await vm.perform(action, state: state, label: label)
                                }
                                .id(msg.id)
                            }
                        }
                        .padding()
                    }
                    .scrollDismissesKeyboard(.immediately)
                    .onChange(of: vm.messages.count) { _, _ in
                        if let last = vm.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
                Divider()
                HStack(spacing: 8) {
                    TextField("Had 2 beers…", text: $vm.draft, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...4).focused($focused)
                        .onSubmit { Task { await vm.send(vm.draft, state: state) } }
                    Button { Task { await vm.send(vm.draft, state: state) } } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title)
                    }
                    .disabled(vm.sending || vm.draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding()
            }
            .navigationTitle("Coach")
            .toolbar {
                if vm.sending { ToolbarItem(placement: .topBarTrailing) { ProgressView() } }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focused = false }.accessibilityIdentifier("keyboardDone")
                }
            }
        }
    }
}

struct MessageBubble: View {
    let message: ChatMessage
    let showMeta: Bool
    let onAction: (ClientAction, String) async -> Void

    var body: some View {
        if message.role == .system && message.text.isEmpty {
            HStack { Image(systemName: "checkmark").font(.caption2).foregroundStyle(.tertiary); Spacer() }.padding(.leading, 8)
        } else { bubble }
    }

    private var bubble: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 8) {
                Text(message.text)
                    .foregroundStyle(message.role == .user ? .white : .primary)
                    // In a lazy list next to a Spacer, SwiftUI can size the text to one line and truncate it; let it grow vertically.
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                if let card = message.card { EntryCardView(card: card, onAction: onAction) }
                if let clarify = message.clarify, let original = message.originalMessage {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(clarify.options) { opt in
                            Button(opt.label) {
                                Task { await onAction(.chooseEntry(entryId: opt.entryId, originalMessage: original), "→ \(opt.label)") }
                            }
                            .buttonStyle(.bordered).tint(.indigo).font(.footnote)
                        }
                        Text("Nothing is written until you choose.").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if showMeta, let meta = message.meta, message.role == .coach {
                    Text(meta).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(background, in: RoundedRectangle(cornerRadius: 16))
            if message.role != .user { Spacer(minLength: 40) }
        }
    }

    private var background: Color {
        switch message.role {
        case .user: return .indigo
        case .system: return .red.opacity(0.12)
        case .coach: return message.safety != nil ? .orange.opacity(0.18) : Color(.secondarySystemBackground)
        }
    }
}

struct EntryCardView: View {
    let card: EntryCard
    let onAction: (ClientAction, String) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                Text("\(card.count.clean) × \(card.beverage) · \(card.serviceDateLabel)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(formatStd(card.stdDrinks, estimate: card.isEstimate)).font(.caption).foregroundStyle(.secondary)
            }
            if let before = card.before {
                Text("Before: \(before.count.clean) on \(Formatting.serviceDateLabel(before.serviceDate, tz: nil))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let chips = card.sizeChips, card.isEstimate {
                SizeChipsRow(chips: chips) { chip in
                    await onAction(.applySize(entryId: card.entryId, volumeMl: chip.volumeMl, abv: chip.abv), "Size: \(chip.label)")
                }
            }
            Button("Undo") { Task { await onAction(.undo(entryId: card.entryId), "Undo") } }
                .font(.footnote.weight(.semibold)).tint(.indigo)
        }
        .padding(10)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}
