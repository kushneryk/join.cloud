(function () {
  var roomId = document.getElementById("messages").dataset.roomId;
  var msgDiv = document.getElementById("messages");
  var es = new EventSource("/api/messages/" + roomId + "/sse");

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  es.onmessage = function (e) {
    if (!e.data) return;
    try {
      var msg = JSON.parse(e.data);
      var isSystem = msg.from === "room-bot";
      var cls = isSystem ? "msg system" : "msg";
      var t = new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      var to = msg.to ? " &rarr; " + esc(msg.to) : "";
      var div = document.createElement("div");
      div.className = cls;
      var body = esc(msg.body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank">$1</a>');
      div.innerHTML = '<span class="from">' + esc(msg.from) + to + '</span><span class="time">' + t + '</span><br><span class="body">' + body + '</span>';
      msgDiv.appendChild(div);
      msgDiv.scrollTop = msgDiv.scrollHeight;
    } catch (err) {}
  };

  msgDiv.scrollTop = msgDiv.scrollHeight;
})();
