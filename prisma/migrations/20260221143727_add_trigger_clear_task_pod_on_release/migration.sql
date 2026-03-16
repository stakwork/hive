-- When a pod's usage_status changes to UNUSED, automatically clear pod_id
-- from the task that was assigned to that pod. Acts as a safety net alongside
-- the application-level cleanup in releasePodById().

CREATE OR REPLACE FUNCTION clear_task_pod_on_release()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.usage_status = 'UNUSED' AND OLD.usage_status != 'UNUSED' THEN
    UPDATE tasks SET pod_id = NULL, agent_password = NULL
    WHERE pod_id = NEW.pod_id AND id = OLD.usage_status_marked_by;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clear_task_pod_on_release
  BEFORE UPDATE ON pods
  FOR EACH ROW
  EXECUTE FUNCTION clear_task_pod_on_release();
