import SwiftUI

enum Theme {
    static let accent = Color(red: 0.122, green: 0.420, blue: 0.400)       // #1F6B66
    static let accentTint = Color(red: 0.886, green: 0.937, blue: 0.925)   // #E2EFEC
    static let warning = Color(red: 0.561, green: 0.298, blue: 0.063)      // #8F4C10
    static let warningTint = Color(red: 0.984, green: 0.937, blue: 0.886)  // #FBEFE2
    static let line = Color(red: 0.835, green: 0.855, blue: 0.831)         // #D5DAD4

    static func regulationFill(_ name: String) -> Color {
        switch name {
        case "Low": return Color(red: 0.863, green: 0.902, blue: 0.949)
        case "Calm": return Color(red: 0.863, green: 0.937, blue: 0.894)
        case "Heightened": return Color(red: 0.984, green: 0.906, blue: 0.784)
        default: return Color(red: 0.957, green: 0.827, blue: 0.800)
        }
    }
}

/// Large, toggle-style button used for every tap target during a session (44pt minimum).
struct ChipButtonStyle: ButtonStyle {
    var selected: Bool
    var fill: Color? = nil
    var minHeight: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(selected ? .bold : .regular))
            .foregroundStyle(fill != nil ? Color.primary : (selected ? Theme.accent : Color.primary))
            .padding(.horizontal, 12)
            .frame(minHeight: minHeight)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(fill ?? (selected ? Theme.accentTint : Color(.secondarySystemGroupedBackground)))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(selected ? (fill != nil ? Color.primary : Theme.accent) : Theme.line, lineWidth: selected ? 2 : 1)
            )
            .opacity(configuration.isPressed ? 0.7 : 1)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct StatusBadge: View {
    enum Kind { case ok, neutral, warning }
    var text: String
    var kind: Kind

    var body: some View {
        Text(text)
            .font(.footnote.weight(.bold))
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .foregroundStyle(kind == .ok ? Theme.accent : kind == .warning ? Theme.warning : Color.primary)
            .background(Capsule().fill(kind == .ok ? Theme.accentTint : kind == .warning ? Theme.warningTint : Color(.tertiarySystemFill)))
    }
}

/// Simple wrapping layout for chip rows.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > maxWidth {
                y += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// UIKit share sheet for exported files.
struct ShareSheet: UIViewControllerRepresentable {
    var items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

struct SharedFile: Identifiable {
    let id = UUID()
    let url: URL
}
