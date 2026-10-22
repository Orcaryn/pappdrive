import Foundation
import Security

public protocol KeyStore: Sendable {
  func get(_ name: String) async throws -> String?
  func set(_ name: String, _ value: String) async throws
  func delete(_ name: String) async throws
}

public struct KeychainError: Error, Sendable, CustomStringConvertible {
  public let status: OSStatus

  public var description: String {
    "keychain: \(SecCopyErrorMessageString(status, nil).map { String($0) } ?? "status \(status)")"
  }
}

/// Keeps values as generic passwords in the app's keychain, available after the first unlock and never backed up to another device.
public struct KeychainKeyStore: KeyStore {
  private let service: String

  public init(service: String = "pappdrive") {
    self.service = service
  }

  private func query(_ name: String) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: name]
  }

  public func get(_ name: String) async throws -> String? {
    var query = query(name)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    if status == errSecItemNotFound {
      return nil
    } else if status != errSecSuccess {
      throw KeychainError(status: status)
    }

    return String(decoding: item as! Data, as: UTF8.self)
  }

  public func set(_ name: String, _ value: String) async throws {
    let data = Data(value.utf8)
    let update = SecItemUpdate(query(name) as CFDictionary, [kSecValueData as String: data] as CFDictionary)

    if update == errSecSuccess {
      return
    } else if update != errSecItemNotFound {
      throw KeychainError(status: update)
    }

    var add = query(name)
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(add as CFDictionary, nil)

    if status != errSecSuccess {
      throw KeychainError(status: status)
    }
  }

  public func delete(_ name: String) async throws {
    let status = SecItemDelete(query(name) as CFDictionary)

    if status != errSecSuccess && status != errSecItemNotFound {
      throw KeychainError(status: status)
    }
  }
}
