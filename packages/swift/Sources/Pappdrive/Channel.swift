import Foundation

/// The host side of the pappdrive RPC envelope over one text transport: sends requests and replies, receives the engine's requests, replies and notifications.
@MainActor
final class Channel {
  typealias Handler = (Data) async throws -> String

  private struct Envelope: Decodable {
    let id: Int?
    let method: String?
    let ok: Bool?
    let error: PappError?
  }

  private struct Reply<T: Decodable>: Decodable {
    let value: T
  }

  private struct Request<P: Decodable>: Decodable {
    let params: P
  }

  private var nextId = 1
  private var pending: [Int: (Result<Data, PappError>) -> Void] = [:]
  private var handlers: [String: Handler] = [:]
  var send: (String) -> Void = { _ in }

  func request<P: Encodable, T: Decodable>(_ method: String, _ params: P) async throws -> T {
    let id = nextId
    nextId += 1
    let text = "{\"id\":\(id),\"method\":\(json(method)),\"params\":\(json(params))}"

    let data: Data = try await withCheckedThrowingContinuation { continuation in
      pending[id] = { continuation.resume(with: $0) }
      send(text)
    }

    return try JSONDecoder().decode(Reply<T>.self, from: data).value
  }

  func request<P: Encodable>(_ method: String, _ params: P) async throws {
    let _: Null = try await request(method, params)
  }

  func requestWithoutReply<P: Encodable>(_ method: String, _ params: P) {
    let id = nextId
    nextId += 1
    send("{\"id\":\(id),\"method\":\(json(method)),\"params\":\(json(params))}")
  }

  func on<P: Decodable, T: Encodable>(_ method: String, _ handler: @escaping (P) async throws -> T) {
    handlers[method] = { data in
      json(try await handler(JSONDecoder().decode(Request<P>.self, from: data).params))
    }
  }

  func on<P: Decodable>(_ method: String, _ handler: @escaping (P) async throws -> Void) {
    handlers[method] = { data in
      try await handler(JSONDecoder().decode(Request<P>.self, from: data).params)

      return "null"
    }
  }

  func receive(_ text: String) {
    let data = Data(text.utf8)

    let envelope = try! JSONDecoder().decode(Envelope.self, from: data)

    if let method = envelope.method {
      guard let handler = handlers[method] else {
        if let id = envelope.id {
          send("{\"id\":\(id),\"ok\":false,\"error\":{\"code\":\"bad-request\",\"message\":\(json("bad-request: Unknown method \"\(method)\"."))}}")
        }

        return
      }

      Task { @MainActor in
        guard let id = envelope.id else {
          _ = try! await handler(data)

          return
        }

        do {
          send("{\"id\":\(id),\"ok\":true,\"value\":\(try await handler(data))}")
        } catch {
          send("{\"id\":\(id),\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\(json(String(describing: error)))}}")
        }
      }

      return
    }

    guard let id = envelope.id, let waiting = pending.removeValue(forKey: id) else {
      return
    }

    if envelope.ok == true {
      waiting(.success(data))
    } else {
      waiting(.failure(envelope.error!))
    }
  }

  func failAll(_ error: PappError) {
    let waiting = pending.values
    pending = [:]

    for resume in waiting {
      resume(.failure(error))
    }
  }
}

struct Null: Decodable {
  init(from decoder: Decoder) throws {}
}

struct Empty: Codable {}

/// Our own value types always encode; a failure here is a bug, not a runtime condition.
func json<T: Encodable>(_ value: T) -> String {
  String(decoding: try! JSONEncoder().encode(value), as: UTF8.self)
}
