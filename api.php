<?php
// 1. Security & CORS Headers
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Methods: GET, POST");
header("Access-Control-Allow-Headers: Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");

// 2. Import the database connection
require 'backend/db.php';

$method = $_SERVER['REQUEST_METHOD'];

// --- ROUTE 1: GET (Fetch Leaderboard) ---
if ($method === 'GET') {
    $query = "SELECT player_name, integrity_score, duration_seconds, surgery_status FROM leaderboard ORDER BY integrity_score DESC, duration_seconds ASC";
    $stmt = $conn->prepare($query);
    $stmt->execute();
    
    $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
    http_response_code(200);
    echo json_encode($results);
    exit();
}

// --- ROUTE 2: POST (Save New Score) ---
if ($method === 'POST') {
    $data = json_decode(file_get_contents("php://input"));

    // Now requiring the new surgery_status field
    if (!empty($data->player_name) && isset($data->integrity_score) && isset($data->duration_seconds) && !empty($data->surgery_status)) {
        
        $query = "INSERT INTO leaderboard (player_name, integrity_score, duration_seconds, surgery_status) VALUES (:name, :score, :duration, :status)";
        $stmt = $conn->prepare($query);

        $clean_name = htmlspecialchars(strip_tags($data->player_name));
        $clean_status = htmlspecialchars(strip_tags($data->surgery_status)); // "Completed" or "Stopped"

        $stmt->bindParam(":name", $clean_name);
        $stmt->bindParam(":score", $data->integrity_score);
        $stmt->bindParam(":duration", $data->duration_seconds);
        $stmt->bindParam(":status", $clean_status);

        if ($stmt->execute()) {
            http_response_code(201);
            echo json_encode(["status" => "success", "message" => "Surgery logged successfully."]);
        } else {
            http_response_code(503);
            echo json_encode(["error" => "Database insertion failed."]);
        }
    } else {
        http_response_code(400);
        echo json_encode(["error" => "Incomplete payload. Missing status or other fields."]);
    }
    exit();
}
?>