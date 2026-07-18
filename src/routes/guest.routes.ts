import { Router } from "express";
import { createGuest } from "../controllers/guest.controller";
import { body } from "express-validator";
import { validate } from "../middleware/validation";
const router = Router();

router.post(
  "/",
  [
    body("full_name")
      .notEmpty()
      .withMessage("Full name is required"),

    body("mobile")
      .isLength({ min: 10, max: 15 })
      .withMessage("Invalid mobile number"),

    body("email")
      .optional({ checkFalsy: true })
      .isEmail()
      .withMessage("Invalid email"),
  ],
  validate,
  createGuest
);

export default router;
