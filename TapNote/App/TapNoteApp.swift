import SwiftUI
import SwiftData

@main
struct TapNoteApp: App {
    @State private var preferences = Preferences()
    private let container: ModelContainer

    init() {
        AppStore.clearExports()
        do {
            container = try AppStore.makeContainer()
        } catch {
            fatalError("Couldn't open the TapNote database: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(preferences)
                .tint(Theme.accent)
        }
        .modelContainer(container)
    }
}

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var privacyCover = false

    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "calendar") }
            ReviewView()
                .tabItem { Label("Review", systemImage: "checklist") }
            ReportsView()
                .tabItem { Label("Reports", systemImage: "chart.bar") }
            StudentsView()
                .tabItem { Label("Students", systemImage: "person.2") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        // Hide content in the app switcher snapshot.
        .overlay {
            if privacyCover {
                ZStack {
                    Color(.systemBackground)
                    Label("TapNote", systemImage: "lock.fill")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                .ignoresSafeArea()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            privacyCover = phase != .active
            if phase == .background { AppStore.applyProtection() }
        }
    }
}
