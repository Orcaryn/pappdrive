// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "Pappdrive",
  platforms: [.iOS("16.4")],
  products: [.library(name: "Pappdrive", targets: ["Pappdrive"])],
  targets: [
    .target(name: "Pappdrive", path: "packages/swift/Sources/Pappdrive", resources: [.copy("Resources/pappdrive.js"), .copy("Resources/index.html")]),
    .testTarget(name: "PappdriveTests", dependencies: ["Pappdrive"], path: "packages/swift/Tests/PappdriveTests"),
  ]
)
