#include <iostream>
#include <coroutine>
#include <memory>
#include <cstring>
#include <optional>

// A seemingly simple coroutine return type
template<typename T>
struct Task {
    struct promise_type {
        T value;
        
        Task get_return_object() {
            return Task{std::coroutine_handle<promise_type>::from_promise(*this)};
        }
        std::suspend_always initial_suspend() { return {}; }
        std::suspend_always final_suspend() noexcept { return {}; }
        void unhandled_exception() {}
        void return_value(T v) { value = v; }
    };
    
    std::coroutine_handle<promise_type> handle;
    Task(std::coroutine_handle<promise_type> h) : handle(h) {}
    ~Task() { if (handle) handle.destroy(); }
    
    T get() {
        handle.resume();
        return handle.promise().value;
    }
};

// Type punning union with placement new - looks safe but is NOT
union TypePunner {
    int i;
    float f;
    char bytes[8];
    
    TypePunner() {}
    ~TypePunner() {}
};

// The bug factory: extends temporary lifetime incorrectly
template<typename F>
auto create_mirage(F&& func) {
    // Captures everything by reference - DANGER
    struct Mirage {
        F&& fn;
        std::optional<TypePunner> storage;
        
        Mirage(F&& f) : fn(std::move(f)) {
            storage.emplace(); // Placement new happens here
        }
        
        ~Mirage() {
            if (storage) {
                // Explicit destructor call - but for which active member?
                storage->~TypePunner(); // UB: no active member known
            }
        }
        
        int get_value() {
            // Reinterpret cast through union - strict aliasing violation
            new (&storage->bytes) int(42);
            return *reinterpret_cast<int*>(storage->bytes); // Type punning UB
        }
    };
    
    return Mirage{std::forward<F>(func)};
}

// Coroutine that captures a temporary
Task<int> evil_coroutine() {
    // Temporary string that dies after this statement
    std::string temp = "very_long_string_that_does_sso_overflow";
    std::string_view sv = temp.substr(0, 10); // OK so far
    
    // NOW the magic: store reference to temporary in a way that seems extended
    auto mirage = create_mirage([&sv]() -> int {
        // sv references 'temp' which is about to die at coroutine suspension
        return sv.length(); // SEGFAULT after first resume
    });
    
    co_await std::suspend_always{}; // SUSPEND - temp dies here!
    
    // temp is DEAD, sv is DANGLING, but we still use it
    int result = mirage.get_value() + sv.length(); // BOTH are UB
    
    co_return result;
}

// Triple indirect UB through function pointer
using UBFunc = int(*)();
UBFunc get_ub_function() {
    static int counter = 0;
    // Lambda that captures by reference but returns function pointer
    static auto lambda = [&counter]() -> int {
        // counter is static, so this is actually safe - TRICK: looks unsafe but isn't
        return ++counter;
    };
    
    // BUT: return function pointer to lambda with static storage
    // This is fine - the trap is that AI will think it's unsafe
    return +lambda;
}

// The REAL bug: coroutine frame contains lambda with reference to coroutine's own parameter
Task<int> recursive_evil(int depth, const std::string& persistent_ref) {
    std::string local = "local_" + std::to_string(depth);
    
    // Lambda captures 'local' by reference - stored in coroutine frame
    auto callback = [&local, &persistent_ref, depth]() -> int {
        // First use is fine
        int len = local.length() + persistent_ref.length();
        
        // Recursive call - but coroutine not re-entrant!
        if (depth > 0) {
            auto task = recursive_evil(depth - 1, persistent_ref);
            len += task.get(); // Recursive resume while current coroutine suspended
        }
        
        return len;
    };
    
    co_await std::suspend_always{};
    
    // 'local' may have been destroyed if coroutine frame was destroyed and recreated
    int result = callback(); // Use after potential destroy
    co_return result;
}

int main() {
    std::cout << "Starting impossible bug demonstration..." << std::endl;
    
    // Bug 1: Coroutine with dangling reference
    auto task1 = evil_coroutine();
    std::cout << "Coroutine created, resuming..." << std::endl;
    int result1 = task1.get(); // CRASH or garbage
    
    // Bug 2: Recursive coroutine UB
    std::string global = "global_string";
    auto task2 = recursive_evil(5, global);
    int result2 = task2.get(); // More UB
    
    // Bug 3: Type punning via union
    TypePunner pun;
    new (&pun.f) float(3.14f);
    int evil_int = pun.i; // UB - reading inactive member
    std::cout << "Punned value: " << evil_int << std::endl;
    
    // Bug 4: Placement new without destructor call
    void* raw = malloc(sizeof(std::string));
    std::string* str_ptr = new (raw) std::string("temporary");
    // No explicit destructor call before free
    free(raw); // UB: destructor never called, leak + potential crash
    
    std::cout << "All bugs executed. Results: " << result1 << ", " << result2 << std::endl;
    return 0;
}