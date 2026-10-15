package dev.y9kudo.yourmind.core;

import java.util.*;

/** Atomic bounded enqueue: an invalid repeat never partially adds tasks. */
public final class TaskQueue {
    private final ArrayDeque<Command> tasks = new ArrayDeque<>();
    public void add(Command command, int count) {
        if (command == null || !Command.isJob(command.name()) || count < 1 || count > 16 || tasks.size() + count > 16)
            throw new IllegalArgumentException("Queue accepts at most 16 executable tasks");
        for (int i = 0; i < count; i++) tasks.addLast(command);
    }
    public Command poll() { return tasks.pollFirst(); }
    public int size() { return tasks.size(); }
    public void clear() { tasks.clear(); }
    public List<Command> snapshot() { return List.copyOf(tasks); }
}
