<?php
header('Content-Type: application/json');

try {
    $output = [];
    exec('netstat -ano', $output);
    $pid = null;
    foreach ($output as $line) {
        if (strpos($line, ':3000') !== false && strpos($line, 'LISTENING') !== false) {
            $parts = preg_split('/\s+/', trim($line));
            $pid = end($parts);
            break;
        }
    }
    
    if ($pid && is_numeric($pid)) {
        exec("taskkill /F /PID $pid");
        echo json_encode(["success" => true, "message" => "Server stopped (PID: $pid)"]);
    } else {
        echo json_encode(["success" => true, "message" => "No server process listening on port 3000"]);
    }
} catch (Exception $e) {
    echo json_encode(["success" => false, "error" => $e->getMessage()]);
}
?>
