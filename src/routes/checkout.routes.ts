import { Router } from "express";
import { checkoutGuest } from "../controllers/checkout.controller";

const router = Router();

router.post("/", checkoutGuest);

export default router;