// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TapNoteCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TapNoteCore", targets: ["TapNoteCore"])
    ],
    targets: [
        .target(name: "TapNoteCore"),
        .testTarget(name: "TapNoteCoreTests", dependencies: ["TapNoteCore"])
    ]
)
