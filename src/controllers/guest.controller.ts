import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createGuest = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      full_name,
      mobile,
      email,
      nationality,
      id_type,
      id_number,
    } = req.body;

    const { data, error } = await supabase
      .from("guests")
      .insert([
        {
          full_name,
          mobile,
          email,
          nationality,
          id_type,
          id_number,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};