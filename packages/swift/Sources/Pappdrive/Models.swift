import Foundation

public struct PappError: Error, Sendable, Decodable {
  public let code: String
  public let message: String
  public let retryAfter: Double?
  public let reason: String?

  public init(code: String, message: String, retryAfter: Double? = nil, reason: String? = nil) {
    self.code = code
    self.message = message
    self.retryAfter = retryAfter
    self.reason = reason
  }
}

public struct FileInfo: Decodable, Sendable, Equatable {
  public let path: String
  public let size: Int
  public let mtime: Double
  public let dir: Bool
}

public struct Change: Decodable, Sendable, Equatable {
  public enum Origin: String, Decodable, Sendable {
    case local, remote, conflict, skipped
    case caseDuplicate = "case-duplicate"
  }

  public let path: String
  public let origin: Origin
  public let copy: String?
  public let reason: String?
}

public struct Status: Decodable, Sendable, Equatable {
  public enum Gone: String, Decodable, Sendable {
    case app, account
  }

  public let syncing: Bool
  public let lastSync: Double?
  public let pending: Int
  public let skipped: [String]
  public let deleted: Gone?
  public let error: String?
}

public struct PendingSignUp: Decodable, Sendable, Equatable {
  public let email: String
  public let recoveryCode: String
}
