import { Router } from "express";
import { createGuest } from "../controllers/guest.controller";

const router = Router();

router.post("/", createGuest);

export default router;
