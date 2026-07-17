import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createHelpRequest = async (
  req: Request,
  res: Response
) => {
  try {
    const {
  room_number,
  guest_name,
  help_type,
  notes,
} = req.body;

const { data, error } = await supabase
  .from("help_requests")
  .insert([
    {
      room_number,
      guest_name,
      issue_type: help_type,
      description: notes,
      status: "pending",
    },
  ])
  .select();

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Help request created successfully",
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};