import Foundation

/// The files of one open folder. Paths are relative, `/`-separated; see docs/api.md for the path rules.
@MainActor
public final class Files {
  public let handle: String
  private let host: Host
  private let listeners: Listeners
  private static let slice = 1 << 20

  init(handle: String, host: Host, listeners: Listeners) {
    self.handle = handle
    self.host = host
    self.listeners = listeners
  }

  public func readOnly() async throws -> Bool {
    try await host.channel.request("files.readOnly", Handle(files: handle))
  }

  public func write(_ path: String, text: String) async throws {
    try await host.channel.request("files.writeText", WriteText(files: handle, path: path, text: text))
  }

  public func write(_ path: String, data: Data) async throws {
    let id: Int = try await host.channel.request("files.writeStart", Path(files: handle, path: path))

    for offset in stride(from: data.startIndex, to: data.endIndex, by: Files.slice) {
      let slice = data[offset..<min(offset + Files.slice, data.endIndex)]
      try await host.channel.request("files.writeChunk", Chunk(id: id, base64: slice.base64EncodedString()))
    }

    try await host.channel.request("files.writeEnd", Transfer(id: id))
  }

  /// Streams the file at `file` into `path`, one slice at a time, so a big file never sits in memory whole.
  public func write(_ path: String, contentsOf file: URL) async throws {
    let source = try FileHandle(forReadingFrom: file)
    defer { try? source.close() }
    let id: Int = try await host.channel.request("files.writeStart", Path(files: handle, path: path))

    do {
      while let slice = try source.read(upToCount: Files.slice), !slice.isEmpty {
        try await host.channel.request("files.writeChunk", Chunk(id: id, base64: slice.base64EncodedString()))
      }
    } catch {
      try await host.channel.request("files.cancel", Transfer(id: id))

      throw error
    }

    try await host.channel.request("files.writeEnd", Transfer(id: id))
  }

  public func read(_ path: String) async throws -> Data {
    let id: Int = try await host.channel.request("files.readStart", Path(files: handle, path: path))
    var data = Data()

    while let slice: String = try await host.channel.request("files.readChunk", Transfer(id: id)) {
      data.append(Data(base64Encoded: slice)!)
    }

    return data
  }

  /// Streams `path` into a new file at `file`, one slice at a time. If it throws, the file at `file` is incomplete.
  public func read(_ path: String, to file: URL) async throws {
    FileManager.default.createFile(atPath: file.path, contents: nil)
    let target = try FileHandle(forWritingTo: file)
    defer { try? target.close() }
    let id: Int = try await host.channel.request("files.readStart", Path(files: handle, path: path))

    do {
      while let slice: String = try await host.channel.request("files.readChunk", Transfer(id: id)) {
        try target.write(contentsOf: Data(base64Encoded: slice)!)
      }
    } catch {
      try await host.channel.request("files.cancel", Transfer(id: id))

      throw error
    }
  }

  public func readText(_ path: String) async throws -> String {
    try await host.channel.request("files.readText", Path(files: handle, path: path))
  }

  public func list(_ dir: String? = nil) async throws -> [FileInfo] {
    try await host.channel.request("files.list", List(files: handle, dir: dir))
  }

  public func remove(_ path: String) async throws {
    try await host.channel.request("files.remove", Path(files: handle, path: path))
  }

  public func status() async throws -> Status {
    try await host.channel.request("files.status", Handle(files: handle))
  }

  public func sync() async throws {
    try await host.channel.request("files.sync", Handle(files: handle))
  }

  /// Calls back on the main actor for every change to this folder until the returned closure runs.
  public func watch(_ callback: @escaping @MainActor (Change) -> Void) -> @MainActor () -> Void {
    listeners.add(handle, callback)
  }

  public func onStatus(_ callback: @escaping @MainActor (Status) -> Void) -> @MainActor () -> Void {
    listeners.add(handle, callback)
  }
}

@MainActor
final class Listeners {
  private var changes: [String: [UUID: @MainActor (Change) -> Void]] = [:]
  private var statuses: [String: [UUID: @MainActor (Status) -> Void]] = [:]

  func add(_ handle: String, _ callback: @escaping @MainActor (Change) -> Void) -> @MainActor () -> Void {
    let id = UUID()
    changes[handle, default: [:]][id] = callback

    return { self.changes[handle]?[id] = nil }
  }

  func add(_ handle: String, _ callback: @escaping @MainActor (Status) -> Void) -> @MainActor () -> Void {
    let id = UUID()
    statuses[handle, default: [:]][id] = callback

    return { self.statuses[handle]?[id] = nil }
  }

  func deliver(_ handle: String, _ change: Change) {
    for callback in changes[handle, default: [:]].values {
      callback(change)
    }
  }

  func deliver(_ handle: String, _ status: Status) {
    for callback in statuses[handle, default: [:]].values {
      callback(status)
    }
  }
}

private struct Handle: Encodable {
  let files: String
}

private struct Path: Encodable {
  let files: String
  let path: String
}

private struct List: Encodable {
  let files: String
  let dir: String?
}

private struct WriteText: Encodable {
  let files: String
  let path: String
  let text: String
}

private struct Chunk: Encodable {
  let id: Int
  let base64: String
}

private struct Transfer: Encodable {
  let id: Int
}
