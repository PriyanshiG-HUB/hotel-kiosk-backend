import { Router } from "express";
import { createBooking, getBookingById ,getBookingByRoom,getBookingsByMobile} from "../controllers/booking.controller";
import { body } from "express-validator";
import { validate } from "../middleware/validation";
const router = Router();

router.post(
  "/",
  [
    body("guest_id")
      .notEmpty()
      .withMessage("Guest ID required"),

    body("room_id")
      .notEmpty()
      .withMessage("Room ID required"),

    body("check_in")
      .notEmpty()
      .withMessage("Check-in date required"),

    body("check_out")
      .notEmpty()
      .withMessage("Check-out date required"),

    body("total_amount")
      .isNumeric()
      .withMessage("Amount must be numeric"),
  ],
  validate,
  createBooking
);
router.get("/search/:mobile", getBookingsByMobile);
router.get("/room/:roomNo", getBookingByRoom);
router.get("/:id", getBookingById);

export default router;