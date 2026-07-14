import { Router } from "express";
import { createBooking, getBookingById } from "../controllers/booking.controller";

const router = Router();

router.post("/", createBooking);
router.get("/:id", getBookingById);
export default router;