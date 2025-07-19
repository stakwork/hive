import {
  ChatMessage,
  ChatRole,
  ChatStatus,
  ArtifactType,
  CodeContent,
  BrowserContent,
  FormContent,
  createChatMessage,
  createArtifact,
} from "@/lib/chat";

export function codeMessage(): ChatMessage {
  const baseMessage = createChatMessage({
    id: (Date.now() + 2).toString(),
    message:
      "Perfect! I've created the connection leak monitor implementation. Here's what I've built:",
    role: ChatRole.ASSISTANT,
    status: ChatStatus.SENT,
  });

  return {
    ...baseMessage,
    artifacts: [
      createArtifact({
        id: "550e8400-e29b-41d4-a716-446655440123",
        messageId: "msg_123456",
        type: ArtifactType.CODE,
        content: {
          file: "stakwork/senza-lnd/lib/connection_leak_monitor.rb",
          content: `class ConnectionLeakMonitor
def initialize(pool_size: 5, threshold: 0.8)
@pool_size = pool_size
@threshold = threshold
@active_connections = 0
@leaked_connections = []
@logger = Rails.logger
end

def monitor_connection_pool
current_usage = @active_connections.to_f / @pool_size

if current_usage > @threshold
@logger.warn "Connection pool usage at #{(current_usage * 100).round(2)}%"
detect_leaks
end

log_metrics
end

def track_connection(connection)
@active_connections += 1
@logger.debug "Active connections: #{@active_connections}/#{@pool_size}"
end

def release_connection(connection)
@active_connections -= 1 if @active_connections > 0
@logger.debug "Active connections: #{@active_connections}/#{@pool_size}"
end

private

def detect_leaks
@leaked_connections = find_leaked_connections
@leaked_connections.each do |conn|
@logger.error "Closing leaked connection: #{conn.object_id}"
conn.close
end
end

def find_leaked_connections
# Implementation would check for connections that haven't been 
# returned to the pool within a reasonable timeframe
[]
end

def log_metrics
usage_percent = (@active_connections.to_f / @pool_size * 100).round(2)
@logger.info "Pool usage: #{usage_percent}% (#{@active_connections}/#{@pool_size})"
end
end`,
          change:
            "Create main connection leak monitor class that tracks Aurora Postgres connection pool metrics and detects leaks",
          action: "create",
        } as CodeContent,
      }),
      createArtifact({
        id: "550e8400-e29b-41d4-a716-446655440124",
        messageId: "msg_123457",
        type: ArtifactType.CODE,
        content: {
          file: "stakwork/senza-lnd/config/database.json",
          content: `{
"database": {
"adapter": "postgresql",
"host": "aurora-cluster.cluster-xyz.us-east-1.rds.amazonaws.com",
"port": 5432,
"database": "senza_lnd_production",
"pool": {
"size": 10,
"timeout": 5000,
"checkout_timeout": 5000,
"reaping_frequency": 60
},
"leak_detection": {
"enabled": true,
"threshold": 0.8,
"check_interval": 30000,
"max_connection_age": 300000
}
},
"monitoring": {
"metrics_enabled": true,
"alert_threshold": 0.9,
"log_level": "info",
"cloudwatch_enabled": true
}
}`,
          change:
            "Add Aurora Postgres database configuration with connection leak monitoring settings",
          action: "create",
        } as CodeContent,
      }),
      createArtifact({
        id: "preview-1",
        messageId: "msg_123458",
        type: ArtifactType.BROWSER,
        content: {
          url: "https://community.sphinx.chat",
        } as BrowserContent,
      }),
    ],
  };
}

export function assistantMessage(): ChatMessage {
  const messageId = (Date.now() + 1).toString();
  const baseMessage = createChatMessage({
    id: messageId,
    message:
      "I'll help you build a connection leak monitor for your Aurora Postgres database. Let me create the necessary files and configuration.",
    role: ChatRole.ASSISTANT,
    status: ChatStatus.SENT,
  });

  return {
    ...baseMessage,
    artifacts: [
      createArtifact({
        id: "action-confirm",
        messageId,
        type: ArtifactType.FORM,
        content: {
          actionText:
            "Here's my plan to implement the connection leak monitor:",
          options: [
            {
              actionType: "button",
              optionLabel: "✓ Confirm Plan",
              optionResponse: "confirmed",
              webhook: "https://stakwork.com/api/chat/confirm",
            },
            {
              actionType: "button",
              optionLabel: "✗ Modify Plan",
              optionResponse: "modify",
              webhook: "https://stakwork.com/api/chat/modify",
            },
          ],
        } as FormContent,
      }),
    ],
  };
}
