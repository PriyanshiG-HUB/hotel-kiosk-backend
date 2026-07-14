import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const getRooms = async (
  req: Request,
  res: Response
) => {
  const { data, error } = await supabase
    .from("rooms")
    .select("*");

  if (error) {
    return res.status(500).json(error);
  }

  res.json(data);
};