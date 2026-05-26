<?php
$host = "localhost";
$db_name = "medicrisis_db";
$username = "root"; 
$password = ""; 
try {
    $conn = new PDO("mysql:host=" . $host . ";dbname=" . $db_name, $username, $password);
    $conn->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $exception) {
    http_response_code(500);
    echo json_encode(["error" => "Database Connection Failed: " . $exception->getMessage()]);
    exit();
}
?>