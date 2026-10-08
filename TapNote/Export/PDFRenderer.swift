import UIKit
import CoreText

/// Renders a simple, paginated US Letter PDF: a header block and body text.
enum PDFRenderer {
    struct Block {
        var heading: String?
        var text: String
    }

    static func render(title: String, headerLines: [String], blocks: [Block], footer: String) -> Data {
        let page = CGRect(x: 0, y: 0, width: 612, height: 792)
        let margin: CGFloat = 54

        let doc = NSMutableAttributedString()
        let body = UIFont.systemFont(ofSize: 11)
        let bold = UIFont.boldSystemFont(ofSize: 11)
        let paragraph = NSMutableParagraphStyle()
        paragraph.paragraphSpacing = 6
        paragraph.lineSpacing = 2

        doc.append(NSAttributedString(string: title + "\n", attributes: [.font: UIFont.boldSystemFont(ofSize: 16), .paragraphStyle: paragraph]))
        for line in headerLines {
            doc.append(NSAttributedString(string: line + "\n", attributes: [.font: body, .foregroundColor: UIColor.darkGray, .paragraphStyle: paragraph]))
        }
        doc.append(NSAttributedString(string: "\n"))
        for block in blocks {
            if let heading = block.heading, !heading.isEmpty {
                doc.append(NSAttributedString(string: heading + "\n", attributes: [.font: bold, .paragraphStyle: paragraph]))
            }
            doc.append(NSAttributedString(string: block.text + "\n\n", attributes: [.font: body, .paragraphStyle: paragraph]))
        }

        let framesetter = CTFramesetterCreateWithAttributedString(doc)
        let renderer = UIGraphicsPDFRenderer(bounds: page)
        return renderer.pdfData { ctx in
            var location = 0
            var pageNumber = 1
            repeat {
                ctx.beginPage()
                let cg = ctx.cgContext

                // Footer, drawn in UIKit coordinates.
                let footerText = "\(footer) · Page \(pageNumber)" as NSString
                footerText.draw(at: CGPoint(x: margin, y: page.height - margin / 2 - 8),
                                withAttributes: [.font: UIFont.systemFont(ofSize: 8), .foregroundColor: UIColor.gray])

                // Body, drawn with Core Text in a flipped coordinate system.
                cg.saveGState()
                cg.textMatrix = .identity
                cg.translateBy(x: 0, y: page.height)
                cg.scaleBy(x: 1, y: -1)
                let path = CGPath(rect: page.insetBy(dx: margin, dy: margin), transform: nil)
                let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: location, length: 0), path, nil)
                CTFrameDraw(frame, cg)
                cg.restoreGState()

                let visible = CTFrameGetVisibleStringRange(frame)
                location += visible.length
                pageNumber += 1
                if visible.length == 0 { break }
            } while location < doc.length
        }
    }
}
