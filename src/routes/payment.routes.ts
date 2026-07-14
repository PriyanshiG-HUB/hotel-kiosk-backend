import { Router } from "express";
import { createPayment } from "../controllers/payment.controller";

const router = Router();

router.post("/", createPayment);

export default router;