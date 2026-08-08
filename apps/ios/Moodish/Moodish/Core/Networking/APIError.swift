import Foundation

struct APIErrorBody: Decodable {
    let error: String
    let details: JSONValue?
}

enum APIError: LocalizedError {
    case server(status: Int, message: String)
    case decoding(Error)
    case transport(Error)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .server(_, let message): return message
        case .decoding: return "Moodish sent back something we couldn't read. Try again."
        case .transport: return "Couldn't reach Moodish. Check your connection and try again."
        case .unauthorized: return "You've been signed out. Please log in again."
        }
    }
}
