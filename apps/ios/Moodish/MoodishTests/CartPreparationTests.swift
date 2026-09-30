import XCTest
@testable import Moodish

final class CartPreparationTests: XCTestCase {
    private func decode(_ json: String) throws -> CartPreparation {
        try JSONDecoder().decode(CartPreparation.self, from: Data(json.utf8))
    }
    private let base = #""preparationId":"p","restaurantId":"r","address":{"id":"a","label":"Home","display":"x"},"items":[{"itemId":"i","name":"Soya Chaap","quantity":1,"price":250}],"estimatedItemTotal":250,"note":"n""#

    func testABlockedReviewIsNotConfirmable() throws {
        let review = try decode(#"{\#(base),"existingCart":{"restaurant":"Other","items":[{"itemId":"x","name":"X","quantity":1}],"total":100},"replacesExistingCart":true,"canConfirm":false,"blockedReason":"Swiggy adds to that cart"}"#)
        XCTAssertFalse(review.isConfirmable)
        XCTAssertEqual(review.blockedReason, "Swiggy adds to that cart")
    }

    func testAnOlderServerResponseStaysConfirmable() throws {
        let review = try decode(#"{\#(base),"existingCart":{"items":[],"total":0},"replacesExistingCart":false}"#)
        XCTAssertTrue(review.isConfirmable)
        XCTAssertNil(review.blockedReason)
    }
}
