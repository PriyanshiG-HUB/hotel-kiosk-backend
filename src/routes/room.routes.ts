import { Router } from "express";
import { getRooms } from "../controllers/room.controller";

const router = Router();

router.get("/", getRooms);

export default router;