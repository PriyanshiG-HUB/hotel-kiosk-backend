import { Router } from "express";
import {
  createServiceRequest,
  getServiceRequests,
  updateServiceStatus,
} from "../controllers/service.controller";
import { validate } from "../middleware/validation";
import { body } from "express-validator/lib/middlewares/validation-chain-builders";

const router = Router();

router.post(
  "/",
  [
    body("room_number")
      .notEmpty()
      .withMessage("Room number required"),

    body("service_type")
      .notEmpty()
      .withMessage("Service type required"),
  ],
  validate,
  createServiceRequest
);
router.get("/", getServiceRequests);
router.patch("/:id", updateServiceStatus);

export default router;