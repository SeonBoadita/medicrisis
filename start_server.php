<?php
header('Content-Type: application/json');

try {
    // Use absolute path and redirect stdout/stderr to a log file to avoid EPIPE crashes when popen closes
    $cmd = 'start /B "" "C:\\Program Files\\nodejs\\node.exe" server.js > server.log 2>&1';
    pclose(popen("cd " . __DIR__ . "\\backend && " . $cmd, "r"));
    
    echo json_encode(["success" => true, "message" => "Server started"]);
} catch (Exception $e) {
    echo json_encode(["success" => false, "error" => $e->getMessage()]);
}
?>
