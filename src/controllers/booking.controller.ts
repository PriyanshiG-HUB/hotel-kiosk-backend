import { Request, Response } from "express";
import { supabase } from "../config/supabase";

export const createBooking = async (
  req: Request,
  res: Response
) => {
  try {
    const {
      guest_id,
      room_id,
      check_in,
      check_out,
      nights,
      total_amount,
    } = req.body;

    // Check room status
    const { data: room, error: roomError } = await supabase
      .from("rooms")
      .select("*")
      .eq("room_id", room_id)
      .single();

    if (roomError || !room) {
      return res.status(404).json({
        message: "Room not found",
      });
    }

    if (room.status !== "available") {
      return res.status(400).json({
        message: "Room is already occupied",
      });
    }

    // Create booking
    const { data, error } = await supabase
      .from("bookings")
      .insert([
        {
          guest_id,
          room_id,
          check_in,
          check_out,
          nights,
          total_amount,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json(error);
    }

    // Update room status
    const { error: roomUpdateError } = await supabase
      .from("rooms")
      .update({
        status: "occupied",
      })
      .eq("room_id", room_id);

    if (roomUpdateError) {
      return res.status(500).json({
        message: "Failed to update room status",
        error: roomUpdateError.message,
      });
    }

    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingById = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
  *,
  guests (
    full_name,
    mobile,
    email,
    nationality,
    id_type,
    id_number
  ),
  rooms (
    room_id,
    room_number,
    room_type,
    price_per_night
  )
`)
      .eq("booking_id", id)
      .limit(1);

    if (error || !data || data.length === 0) {
      return res.status(404).json({
        message: "Booking not found",
      });
    }

    res.json(data[0]);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingsByMobile = async (
  req: Request,
  res: Response
) => {
  try {
    const mobile = req.params.mobile as string;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mobile);

    let query = supabase
      .from("bookings")
      .select(`
  booking_id,
  booking_status,
  check_in,
  check_out,
  nights,
  total_amount,
  guests!inner (
    full_name,
    mobile,
    email,
    nationality,
    id_type,
    id_number
  ),
  rooms (
    room_id,
    room_number,
    room_type,
    price_per_night
  )
`)

    if (isUuid) {
      query = query.eq("booking_id", mobile);
    } else {
      query = query.eq("guests.mobile", mobile);
    }

    const { data, error } = await query
      .eq("booking_status", "confirmed")
      .order("check_in", { ascending: false })
      .limit(1);

    if (error || !data || data.length === 0) {
      return res.status(404).json({
        message: "No booking found",
      });
    }

    res.json(data[0]);
  } catch (error) {
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingByRoom = async (
  req: Request,
  res: Response
) => {
  try {
    const { roomNo } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
  booking_id,
  booking_status,
  check_in,
  check_out,
  nights,
  total_amount,
  guests (
    full_name,
    mobile,
    email,
    nationality,
    id_type,
    id_number
  ),
  rooms!inner (
    room_id,
    room_number,
    room_type,
    price_per_night
  )
`)
      .eq("rooms.room_number", roomNo)
      .eq("booking_status", "confirmed")
      .order("check_in", { ascending: false })
      .limit(1);

    console.log(
      "Room Search Result:",
      data,
      error
    );

    if (error || !data || data.length === 0) {
      return res.status(404).json({
        message: "No booking found",
      });
    }

    res.json(data[0]);
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};

export const getBookingsByGuestName = async (
  req: Request,
  res: Response
) => {
  try {
    const { name } = req.params;

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        booking_id,
        booking_status,
        check_in,
        check_out,
        nights,
        total_amount,
        guests!inner (
          full_name,
          mobile,
          email,
          nationality,
          id_type,
          id_number
        ),
        rooms (
          room_id,
          room_number,
          room_type,
          price_per_night
        )
      `)
      .ilike("guests.full_name", `%${name}%`)
      .eq("booking_status", "confirmed")
      .limit(2);

    if (error || !data || data.length === 0) {
      return res.status(404).json({
        message: "No booking found",
      });
    }

    if (data.length > 1) {
      return res.status(300).json({
        message: "Multiple matching guests found. Please search by room number to select the correct guest.",
      });
    }

    res.json(data[0]);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: "Internal Server Error",
    });
  }
};