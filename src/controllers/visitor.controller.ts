import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createVisitor = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      full_name,
      mobile,
      purpose,
      host_room,
      host_guest,
      id_type,
      id_number,
    } = req.body;

    const { data, error } = await supabase
      .from("visitors")
      .insert([
        {
          full_name,
          mobile,
          purpose,
          host_room,
          host_guest,
          id_type,
          id_number,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getVisitors = async (
  req: Request,
  res: Response
) => {
  try {
    const { data, error } = await supabase
      .from("visitors")
      .select("*")
      .order("check_in_time", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};
export const getVisitorById = async (
  req: Request,
  res: Response
) => {
  try {
    const { visitorId } = req.params;

    const { data, error } = await supabase
      .from("visitors")
      .select("*")
      .eq("visitor_id", visitorId)
      .single();

    if (error || !data) {
      return res.status(404).json({
        message: "Visitor not found",
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const searchVisitorByName = async (
  req: Request,
  res: Response
) => {
  try {
    const { name } = req.params;

    const { data, error } = await supabase
      .from("visitors")
      .select("*")
      .ilike("full_name", `%${name}%`)
      .order("check_in_time", {
        ascending: false,
      });

    if (error) {
      return res.status(500).json(error);
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};
export const checkoutVisitor = async (
  req: Request,
  res: Response
) => {
  try {
    const { visitor_id } = req.body;

    const { data, error } = await supabase
      .from("visitors")
      .update({
        status: "checked_out",
        check_out_time: new Date().toISOString()
      })
      .eq("visitor_id", visitor_id)
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    res.json({
      message: "Visitor checked out successfully",
      visitor: data
    });
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error"
    });
  }
};