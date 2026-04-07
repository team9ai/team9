import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
    print("Usage: set_icon <icon.icns> <target_path>")
    exit(1)
}

let iconPath = args[1]
let targetPath = args[2]

guard let icon = NSImage(contentsOfFile: iconPath) else {
    print("Failed to load icon from \(iconPath)")
    exit(1)
}

let result = NSWorkspace.shared.setIcon(icon, forFile: targetPath, options: [])
print("setIcon result: \(result)")
exit(result ? 0 : 1)
