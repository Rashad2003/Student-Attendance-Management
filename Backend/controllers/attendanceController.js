import Attendance from "../models/attendanceModel.js";
import Student from "../models/studentModel.js";
import { sendSMS } from "../smsSender.js";

export const markAttendance = async (req, res) => {
  const { department, year, section, semester, date, students } = req.body;

  try {
    const attendanceDate = new Date(date);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let attendanceDoc = await Attendance.findOne({
      department,
      year,
      section,
      semester,
      date: {
        $gte: attendanceDate,
        $lte: endOfDay,
      },
    });

    if (!attendanceDoc) {
      attendanceDoc = new Attendance({
        department,
        year,
        section,
        semester,
        date,
        facultyId: req.user?.id || null,
        students: [],
      });
    }

    students.forEach(({ studentId, name, register, periods }) => {
      let existingStudent = attendanceDoc.students.find(
        (s) => s.studentId.toString() === studentId
      );

      const formattedPeriods = periods.map(({ periodNumber, subject, status }) => ({
        periodNumber: String(periodNumber),
        subject: subject || "", // Ensure subject is passed here
        status: status || "Present",
      }));

      if (!existingStudent) {
        attendanceDoc.students.push({
          studentId,
          name,
          register,
          department,
          year,
          section,
          periods: formattedPeriods,
        });
      } else {
        formattedPeriods.forEach(({ periodNumber, subject, status }) => {
          const existingPeriod = existingStudent.periods.find(
            (p) => p.periodNumber === String(periodNumber)
          );

          if (existingPeriod) {
            existingPeriod.status = status;
            existingPeriod.subject = subject;
          } else {
            existingStudent.periods.push({ periodNumber, subject, status });
          }
        });
      }
    });

    await attendanceDoc.save();
    return res.status(200).json({ success: true, message: "Attendance saved/updated successfully." });

  } catch (err) {
    console.error("Mark Attendance Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


export const viewAttendance = async (req, res) => {
  const { department, year, section, semester, date } = req.query;

  try {
    // Validate and parse date
    if (!date || isNaN(Date.parse(date))) {
      return res.status(400).json({ success: false, message: "Invalid or missing date" });
    }

    const attendanceDate = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    // Find the record for the given filters
    const record = await Attendance.findOne({
      department,
      year,
      section,
      semester,
      date: {
        $gte: attendanceDate,
        $lte: endOfDay,
      },
    });

    if (!record) {
      return res.json({ success: false, message: "No record found" });
    }

    // Prepare formatted student data
    const students = record.students.map((student) => {
      const periodsStatus = Array.from({ length: 8 }, (_, i) => {
        const periodNumber = String(i + 1);
        const periodData = student.periods.find(p => p.periodNumber === periodNumber);
        return periodData ? periodData.status : "Not Marked";
      });

      return {
        studentId: student.studentId,
        name: student.name,
        register: student.register,
        periodsStatus, // Array of 8 statuses
      };
    });

    return res.json({ success: true, students });

  } catch (err) {
    console.error("Fetch Attendance Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};


export const sendMessageToParent = async (req, res) => {
  const { studentId, message } = req.body;

  if (!studentId || !message) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  try {
    const student = await Student.findById(studentId);

    if (!student || !student.phone) {
      return res.status(404).json({ success: false, message: "Student or phone number not found" });
    }
    console.log("Phone number:", student.phone);

    const result = await sendSMS(student.phone, message);

    if (result.success) {

      res.status(200).json({ success: true, message: "Message sent to parent" });
    } else {
      res.status(500).json({ success: false, message: result.error });
    }
  } catch (err) {
    console.error("Send Message Error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


export const getClassReport = async (req, res) => {
  const { fromDate, toDate, department, year, section, } = req.query;

  try {
    if (!fromDate || !toDate || !department || !year || !section) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Find all students in that class (case-insensitive)
    const students = await Student.find({
      department: { $regex: new RegExp(department, "i") },
      year,
      section,
    });

    if (!students.length) {
      return res.status(404).json({ success: false, message: "No students found for this class" });
    }

    // Fetch attendance records for the class and date range
    const attendanceRecords = await Attendance.find({
      department: { $regex: new RegExp(department, "i") },
      year,
      section,
      date: {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      },
    });

    // Map student statistics
    const studentStats = students.map((student) => {
      let totalPeriods = 0;
      let presentCount = 0;

      attendanceRecords.forEach((record) => {
        const studentData = record.students.find(
          (s) => s.studentId?.toString() === student._id.toString()
        );
        if (studentData) {
          const periods = studentData.periods || [];
          totalPeriods += periods.length;
          presentCount += periods.filter((p) => p.status === "Present").length;
        }
      });

      const percentage = totalPeriods ? (presentCount / totalPeriods) * 100 : 0;

      return {
        _id: student._id,
        name: student.name,
        register: student.register,
        department: student.department, 
        year: student.year, 
        section: student.section,
        totalPeriods,
        presentCount,
        percentage,
      };
    });

    res.status(200).json({ success: true, data: studentStats });
  } catch (error) {
    console.error("Report Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getStudentReport = async (req, res) => {
  const { studentId } = req.params;

  try {

    const student = await Student.findById(studentId);

    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const attendanceRecords = await Attendance.find({
      "students.studentId": student._id,
    });

    let totalPeriods = 0;
    let presentCount = 0;

    attendanceRecords.forEach((record) => {
      const data = record.students.find(
        (s) => s.studentId.toString() === student._id.toString()
      );
      if (data) {
        totalPeriods += data.periods.length;
        presentCount += data.periods.filter((p) => p.status === "Present").length;
      }
    });

    const percentage = totalPeriods ? (presentCount / totalPeriods) * 100 : 0;

    return res.status(200).json({
      success: true,
      data: {
        _id: student._id,
        name: student.name,
        register: student.register,
        department: student.department, 
        year: student.year, 
        section: student.section,
        totalPeriods,
        presentCount,
        absentCount: totalPeriods - presentCount,
        percentage,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

export const fetchAttendance = async (req, res) => {
  const { department, year, section, semester, date } = req.query;

  try {
    // Validate and parse date
    if (!date || isNaN(Date.parse(date))) {
      return res.status(400).json({ success: false, message: "Invalid or missing date" });
    }

    const attendanceDate = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    // Find the record for the given filters
    const record = await Attendance.findOne({
      department,
      year,
      section,
      semester,
      date: {
        $gte: attendanceDate,
        $lte: endOfDay,
      },
    });

    if (!record) {
      return res.json({ success: false, message: "No record found" });
    }

    // Prepare formatted student data
    const students = record.students.map((student) => {
      const periodsStatus = Array.from({ length: 8 }, (_, i) => {
        const periodNumber = String(i + 1);
        const periodData = student.periods.find(p => p.periodNumber === periodNumber);
        return periodData ? periodData.status : "Not Marked";
      });

      return {
        studentId: student.studentId,
        name: student.name,
        register: student.register,
        periodsStatus, // Array of 8 statuses
      };
    });

    return res.json({ success: true, students });

  } catch (err) {
    console.error("Fetch Attendance Error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

