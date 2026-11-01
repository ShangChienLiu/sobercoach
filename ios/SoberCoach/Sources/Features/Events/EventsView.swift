import SwiftUI

struct EventsView: View {
    @EnvironmentObject private var state: AppState
    @State private var title = ""
    @State private var date = Date().addingTimeInterval(86400 * 2)
    @State private var busy = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Tell the coach \"Party at Sam's in 5 days\" or add one here. Three hours before, you'll get one push with your weekly pace, if that reminder is on.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Add") {
                    TextField("Title", text: $title)
                    DatePicker("Starts", selection: $date)
                    Button("Save event") { Task { await save() } }.disabled(busy || title.isEmpty)
                }
                Section("Upcoming") {
                    if state.events.isEmpty { Text("No upcoming events").foregroundStyle(.secondary) }
                    ForEach(state.events) { ev in
                        VStack(alignment: .leading) {
                            Text(ev.title).font(.body.weight(.medium))
                            Text(ev.startsAt.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("Events")
            .refreshable { await state.refresh() }
        }
    }

    private func save() async {
        busy = true; defer { busy = false }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: state.profile?.timezone ?? TimeZone.current.identifier)
        f.dateFormat = "EEEE MMM d 'at' h:mm a"
        _ = await state.send(message: "Add event: \(title) on \(f.string(from: date))")
        title = ""
    }
}
