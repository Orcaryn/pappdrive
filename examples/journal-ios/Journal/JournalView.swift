import Pappdrive
import SwiftUI

struct JournalView: View {
  @ObservedObject var model: JournalModel
  @FocusState private var editing: Bool

  var body: some View {
    NavigationSplitView {
      List(model.entries, id: \.self, selection: Binding(get: { model.current }, set: { name in Task { await model.select(name ?? JournalModel.today()) } })) { name in
        Text(label(name))
          .foregroundStyle(name.contains("(conflict ") ? .orange : .primary)
      }
      .navigationTitle("Journal")
      .toolbar {
        Button("Today") { Task { await model.select(JournalModel.today()) } }
        Button("Sign out") { Task { await model.signOut() } }
      }
    } detail: {
      VStack(alignment: .leading, spacing: 8) {
        TextEditor(text: $model.text)
          .onChange(of: model.text) { _ in model.textChanged() }
          .font(.body)
          .accessibilityIdentifier("editor")
          .focused($editing)
          .onAppear { editing = true }
        if let notice = model.notice {
          Text(notice).font(.footnote).foregroundStyle(.red).onTapGesture { model.notice = nil }
        }
        Text(statusText).font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("status")
      }
      .padding()
      .navigationTitle(label(model.current))
      .toolbar {
        Button("Sync") { Task { await model.sync() } }
        Button("Delete", role: .destructive) { Task { await model.deleteEntry() } }
      }
    }
  }

  private var statusText: String {
    guard let s = model.status else {
      return ""
    }

    if s.syncing {
      return "Syncing…"
    } else if let error = s.error {
      return "Not synced: \(error)"
    } else if s.pending > 0 {
      return "\(s.pending) change\(s.pending == 1 ? "" : "s") waiting"
    } else if let last = s.lastSync {
      return "Synced " + Date(timeIntervalSince1970: last / 1000).formatted(date: .omitted, time: .shortened)
    }

    return "Not synced yet"
  }

  private func label(_ name: String) -> String {
    let base = String(name.dropLast(3))
    let parser = DateFormatter()
    parser.dateFormat = "yyyy-MM-dd"

    guard let date = parser.date(from: base) else {
      return base
    }

    return date.formatted(.dateTime.weekday(.abbreviated).year().month(.abbreviated).day())
  }
}
