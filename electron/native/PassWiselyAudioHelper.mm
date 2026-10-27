// Audio-only helper. No network, audio files, argv/env logging, or raw NSError output.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <vector>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

__attribute__((used, section("__TEXT,__info_plist"))) static const char kInfoPlist[] = R"plist(<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.passwisely.desktop.audio-helper</string><key>CFBundleName</key><string>PassWisely Audio Helper</string><key>CFBundleVersion</key><string>1</string><key>NSMicrophoneUsageDescription</key><string>PassWisely captures microphone audio when you start a conversation.</string><key>NSScreenCaptureUsageDescription</key><string>PassWisely captures system audio when you start a conversation.</string><key>NSAudioCaptureUsageDescription</key><string>PassWisely captures system audio when you start a conversation.</string></dict></plist>)plist";

static constexpr size_t kMaxLine = 65536, kMaxOutput = 512 * 1024;
static constexpr AVAudioFrameCount kMaxFrames = 16384;
static constexpr size_t kMaxInputBytes = 1024 * 1024;
// Fixed protocol error codes; never serialize operating-system error descriptions.
static NSString *const kProtocolError = @"PROTOCOL_ERROR";
static NSString *const kInvalidState = @"INVALID_STATE";

class PWOutput {
    std::mutex mutex;
    std::deque<std::vector<uint8_t>> queue;
    size_t bytes = 0, offset = 0;
    bool accepting = false, writing = false, broken = false, finishing = false;
    int result = 0;
    std::string pendingError;
    dispatch_source_t wake, writable, exitTimer;
public:
    std::function<void(NSString *)> onError;
    PWOutput() {
        int flags = fcntl(STDOUT_FILENO, F_GETFL);
        if (flags < 0 || fcntl(STDOUT_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) exit(1);
        wake = dispatch_source_create(DISPATCH_SOURCE_TYPE_DATA_ADD, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(wake, ^{ flush(); }); dispatch_resume(wake);
        writable = dispatch_source_create(DISPATCH_SOURCE_TYPE_WRITE, STDOUT_FILENO, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(writable, ^{ flush(); });
        exitTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(exitTimer, ^{ exit(result ? result : 1); }); dispatch_resume(exitTimer);
        dispatch_source_set_timer(exitTimer, DISPATCH_TIME_FOREVER, DISPATCH_TIME_FOREVER, 0);
    }
    void setAccepting(bool value) { std::lock_guard<std::mutex> lock(mutex); accepting = value; }
    bool isAccepting() { std::lock_guard<std::mutex> lock(mutex); return accepting; }
    void fail(NSString *code) {
        { std::lock_guard<std::mutex> lock(mutex); if (pendingError.empty()) pendingError = code.UTF8String; accepting = false; }
        dispatch_source_merge_data(wake, 1);
    }
    void event(NSDictionary *value, bool audio = false) {
        @autoreleasepool {
            NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
            if (!data || data.length + 1 > kMaxLine) { fail(@"INTERNAL_ERROR"); return; }
            {
                std::lock_guard<std::mutex> lock(mutex);
                if (broken || (audio && !accepting)) return;
                if (bytes + data.length + 1 > kMaxOutput) {
                    accepting = false;
                    if (pendingError.empty()) pendingError = "OUTPUT_BACKPRESSURE";
                    // Keep a partially written line intact; drop only whole queued audio lines.
                    if (offset) { auto first = std::move(queue.front()); queue.clear(); bytes = first.size() - offset; queue.push_back(std::move(first)); }
                    else { queue.clear(); bytes = 0; }
                } else {
                    const uint8_t *p = static_cast<const uint8_t *>(data.bytes);
                    queue.emplace_back(p, p + data.length); queue.back().push_back('\n'); bytes += data.length + 1;
                }
            }
            dispatch_source_merge_data(wake, 1);
        }
    }
    void deliverError() {
        std::string error;
        { std::lock_guard<std::mutex> lock(mutex); error.swap(pendingError); }
        if (!error.empty() && onError) onError([NSString stringWithUTF8String:error.c_str()]);
    }
    void finish(int code) {
        finishing = true; result = code; setAccepting(false);
        dispatch_source_set_timer(exitTimer, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), DISPATCH_TIME_FOREVER, 0);
        dispatch_source_merge_data(wake, 1);
    }
private:
    void flush() {
        deliverError();
        bool blocked = false, closed = false, empty = false;
        {
            std::lock_guard<std::mutex> lock(mutex);
            while (!queue.empty() && !broken) {
                const auto &front = queue.front(); ssize_t n = write(STDOUT_FILENO, front.data() + offset, front.size() - offset);
                if (n > 0) { offset += n; bytes -= n; if (offset == front.size()) { queue.pop_front(); offset = 0; } }
                else if (n < 0 && errno == EINTR) continue;
                else if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) { blocked = true; break; }
                else { broken = true; accepting = false; closed = true; queue.clear(); bytes = offset = 0; }
            }
            empty = queue.empty();
        }
        if (blocked && !writing) { writing = true; dispatch_resume(writable); }
        if (!blocked && writing) { writing = false; dispatch_suspend(writable); }
        if (closed) { result = 1; if (onError) onError(@"OUTPUT_CLOSED"); }
        if (finishing && (empty || broken)) exit(result);
    }
};

static bool PWValidBuffer(AVAudioPCMBuffer *buffer) {
    AVAudioFormat *format = buffer.format;
    if (!buffer.frameLength || buffer.frameLength > kMaxFrames || format.channelCount < 1 || format.channelCount > 8 || !std::isfinite(format.sampleRate) || format.sampleRate < 8000 || format.sampleRate > 192000) return false;
    const AudioBufferList *list = buffer.audioBufferList; size_t bytes = 0;
    if (!list || !list->mNumberBuffers || list->mNumberBuffers > 8) return false;
    for (UInt32 i = 0; i < list->mNumberBuffers; ++i) { bytes += list->mBuffers[i].mDataByteSize; if (!list->mBuffers[i].mData || bytes > kMaxInputBytes) return false; }
    return true;
}

static void PWEmitPCM(AVAudioPCMBuffer *buffer, NSString *source, PWOutput *output) {
    const uint8_t *pcm = reinterpret_cast<const uint8_t *>(buffer.int16ChannelData[0]);
    size_t total = buffer.frameLength * sizeof(int16_t);
    // Both supported architectures are little-endian. At most 100 ms per line.
    for (size_t offset = 0; offset < total; offset += 3200) {
        NSData *data = [NSData dataWithBytes:pcm + offset length:std::min<size_t>(3200, total - offset)];
        output->event(@{@"event": @"audio", @"source": source, @"audio": [data base64EncodedStringWithOptions:0]}, true);
    }
}

@interface PWConverter : NSObject
@property(nonatomic, strong) AVAudioConverter *converter;
- (BOOL)convert:(AVAudioPCMBuffer *)input source:(NSString *)source output:(PWOutput *)output;
- (BOOL)finishSource:(NSString *)source output:(PWOutput *)output;
@end
@implementation PWConverter
- (BOOL)convert:(AVAudioPCMBuffer *)input source:(NSString *)source output:(PWOutput *)output {
    if (!PWValidBuffer(input)) return NO;
    if (_converter && ![_converter.inputFormat isEqual:input.format]) {
        // A new device format ends the previous conversion stream; preserve its
        // finite filter tail before replacing the converter for this source.
        if (![self finishSource:source output:output]) return NO;
        _converter = nil;
    }
    if (!_converter) {
        AVAudioFormat *target = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
        _converter = [[AVAudioConverter alloc] initFromFormat:input.format toFormat:target];
        if (!_converter) return NO;
        _converter.downmix = YES; _converter.primeMethod = AVAudioConverterPrimeMethod_None;
    }
    AVAudioFrameCount capacity = (AVAudioFrameCount)ceil(input.frameLength * 16000.0 / input.format.sampleRate) + 256;
    if (capacity > 33024) return NO;
    AVAudioPCMBuffer *converted = [[AVAudioPCMBuffer alloc] initWithPCMFormat:_converter.outputFormat frameCapacity:capacity];
    __block BOOL supplied = NO;
    // Drain the converter before accepting another input buffer. HaveData means the
    // output capacity filled and does not prove the supplied input was exhausted.
    for (unsigned attempt = 0; attempt < 8; ++attempt) {
        NSError *error = nil; converted.frameLength = 0;
        AVAudioConverterOutputStatus status = [_converter convertToBuffer:converted error:&error withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount requested, AVAudioConverterInputStatus *outStatus) {
            (void)requested;
            if (supplied) { *outStatus = AVAudioConverterInputStatus_NoDataNow; return nil; }
            supplied = YES; *outStatus = AVAudioConverterInputStatus_HaveData; return input;
        }];
        if (error || status == AVAudioConverterOutputStatus_Error || !converted.int16ChannelData) return NO;
        size_t total = converted.frameLength * sizeof(int16_t);
        PWEmitPCM(converted, source, output);
        if (status == AVAudioConverterOutputStatus_InputRanDry || status == AVAudioConverterOutputStatus_EndOfStream) return YES;
        if (!total) return NO;
    }
    return NO;
}
- (BOOL)finishSource:(NSString *)source output:(PWOutput *)output {
    if (!_converter) return YES;
    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:_converter.outputFormat frameCapacity:2048];
    for (unsigned attempt = 0; attempt < 8; ++attempt) {
        NSError *error = nil; buffer.frameLength = 0;
        AVAudioConverterOutputStatus status = [_converter convertToBuffer:buffer error:&error withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount requested, AVAudioConverterInputStatus *outStatus) {
            (void)requested; *outStatus = AVAudioConverterInputStatus_EndOfStream; return nil;
        }];
        if (error || status == AVAudioConverterOutputStatus_Error || !buffer.int16ChannelData) return NO;
        PWEmitPCM(buffer, source, output);
        if (status == AVAudioConverterOutputStatus_EndOfStream || (status == AVAudioConverterOutputStatus_InputRanDry && !buffer.frameLength)) return YES;
        if (!buffer.frameLength) return NO;
    }
    return NO;
}

@end

typedef NS_ENUM(NSUInteger, PWPhase) { PWIdle, PWPreparing, PWReady, PWConfiguring, PWStarting, PWRecording, PWStopping, PWPaused, PWEnded };
@interface PWCapture : NSObject <SCStreamOutput, SCStreamDelegate> {
    PWOutput *_output;
    PWPhase _phase;
    BOOL _wantPaused, _wantEnd, _failed, _tapInstalled, _prepared;
    SCDisplay *_display;
    NSUInteger _generation;
    AVAudioEngine *_engine;
    SCStream *_stream;
    id _configurationObserver;
    PWConverter *_systemConverter, *_microphoneConverter;
    dispatch_queue_t _samples, _work, _permissions;
    dispatch_semaphore_t _slots;
    dispatch_source_t _deadline;
    std::atomic<bool> _acceptWork;
    std::atomic<NSUInteger> _audioGeneration;
    std::atomic<void *> _activeStream;
    std::mutex _admission;
}
- (instancetype)initWithOutput:(PWOutput *)output;
- (void)command:(NSString *)command;
- (void)stop;
- (void)fail:(NSString *)code;
- (void)microphonePermission:(void (^)(BOOL))completion;
- (void)screenPermission:(void (^)(BOOL))completion;
- (void)displayForCapture:(void (^)(SCDisplay *, NSString *))completion;
- (void)prepared;
@end
@implementation PWCapture
- (instancetype)initWithOutput:(PWOutput *)output {
    if ((self = [super init])) {
        _output = output; _phase = PWIdle; _acceptWork.store(false); _audioGeneration.store(0); _activeStream.store(nullptr);
        _samples = dispatch_queue_create("com.passwisely.audio.samples", DISPATCH_QUEUE_SERIAL);
        _work = dispatch_queue_create("com.passwisely.audio.convert", DISPATCH_QUEUE_SERIAL);
        _slots = dispatch_semaphore_create(4);
        _permissions = dispatch_queue_create("com.passwisely.audio.permission", DISPATCH_QUEUE_SERIAL);
        _deadline = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        __weak PWCapture *weak = self;
        dispatch_source_set_event_handler(_deadline, ^{
            PWCapture *owner = weak; if (!owner) return;
            [owner closeAudio]; owner->_wantEnd = YES; owner->_failed = YES; owner->_phase = PWEnded; ++owner->_generation; [owner deadline:0];
            [owner stopMicrophone]; owner->_stream = nil;
            owner->_output->event(@{@"event": @"error", @"code": @"CAPTURE_TIMEOUT"});
            // No 'ended' acknowledgement when the framework did not confirm release.
            owner->_output->finish(1);
        });
        dispatch_resume(_deadline); [self deadline:0];
    }
    return self;
}
- (void)deadline:(NSUInteger)seconds {
    dispatch_source_set_timer(_deadline, seconds ? dispatch_time(DISPATCH_TIME_NOW, seconds * NSEC_PER_SEC) : DISPATCH_TIME_FOREVER, DISPATCH_TIME_FOREVER, 0);
}
- (void)state:(NSString *)state { _output->event(@{@"event": @"state", @"state": state}); }
- (void)prepared { _output->event(@{@"event": @"prepared"}); }
- (void)command:(NSString *)command {
    if ([command isEqualToString:@"stop"]) { [self stop]; return; }
    if (_wantEnd || _phase == PWEnded) return;
    if ([command isEqualToString:@"prepare"] && _phase == PWIdle) { [self beginPrepare]; return; }
    if ([command isEqualToString:@"start"] && _phase == PWReady && _prepared) { [self beginStart]; return; }
    if ([command isEqualToString:@"pause"] && (_phase == PWStarting || _phase == PWRecording || _phase == PWStopping || _phase == PWPaused)) { _wantPaused = YES; [self beginStop]; return; }
    if ([command isEqualToString:@"resume"] && (_wantPaused || _phase == PWPaused)) {
        _wantPaused = NO; if (_phase == PWPaused) [self beginStart]; return;
    }
    [self fail:kInvalidState];
}
- (void)fail:(NSString *)code {
    if (_phase == PWEnded) return;
    _output->setAccepting(false);
    if (!_failed) { _failed = YES; _output->event(@{@"event": @"error", @"code": code}); }
    [self stop];
}
- (void)stop { _wantEnd = YES; [self beginStop]; }
- (void)microphonePermission:(void (^)(BOOL))completion {
    AVAuthorizationStatus authorization = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    if (authorization == AVAuthorizationStatusNotDetermined) [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:completion];
    else completion(authorization == AVAuthorizationStatusAuthorized);
}
- (void)screenPermission:(void (^)(BOOL))completion {
    if (CGPreflightScreenCaptureAccess()) { completion(YES); return; }
    // Exactly one preparation may be pending. A blocking OS permission prompt
    // must not block stdin EOF/stop on the main control queue.
    dispatch_async(_permissions, ^{ BOOL granted = CGRequestScreenCaptureAccess(); completion(granted && CGPreflightScreenCaptureAccess()); });
}
- (void)displayForCapture:(void (^)(SCDisplay *, NSString *))completion {
    if (![AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeAudio]) { completion(nil, @"MICROPHONE_UNAVAILABLE"); return; }
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES completionHandler:^(SCShareableContent *content, NSError *error) {
        if (error) { completion(nil, ([error.domain isEqualToString:SCStreamErrorDomain] && error.code == SCStreamErrorUserDeclined) ? @"SCREEN_PERMISSION_DENIED" : @"SYSTEM_AUDIO_UNAVAILABLE"); return; }
        if (!content.displays.count) { completion(nil, @"NO_DISPLAY"); return; }
        completion(content.displays.firstObject, nil);
    }];
}
- (void)beginPrepare {
    _phase = PWPreparing; NSUInteger token = ++_generation; [self deadline:0];
    // Human permission decisions precede the short-lived session token. There
    // are no capture resources yet, and EOF/stop invalidates every callback.
    [self microphonePermission:^(BOOL microphone) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (token != self->_generation || self->_phase != PWPreparing) return;
            if (!microphone) { [self fail:@"MICROPHONE_PERMISSION_DENIED"]; return; }
            [self screenPermission:^(BOOL screen) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (token != self->_generation || self->_phase != PWPreparing) return;
                    if (!screen) { [self fail:@"SCREEN_PERMISSION_DENIED"]; return; }
                    [self displayForCapture:^(SCDisplay *display, NSString *code) {
                        dispatch_async(dispatch_get_main_queue(), ^{
                            if (token != self->_generation || self->_phase != PWPreparing) return;
                            if (code || !display) { [self fail:code ?: @"NO_DISPLAY"]; return; }
                            self->_display = display; self->_prepared = YES; self->_phase = PWReady; [self prepared];
                        });
                    }];
                });
            }];
        });
    }];
}
- (void)beginStart {
    if (_wantEnd) { [self beginStop]; return; }
    if (!_prepared || !_display) { [self fail:kInvalidState]; return; }
    // Check for revocation without another prompt after the token was minted.
    if (!CGPreflightScreenCaptureAccess()) { [self fail:@"SCREEN_PERMISSION_DENIED"]; return; }
    if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] != AVAuthorizationStatusAuthorized) { [self fail:@"MICROPHONE_PERMISSION_DENIED"]; return; }
    _phase = PWConfiguring; NSUInteger token = ++_generation; _audioGeneration.store(token); [self deadline:10];
    [self startDisplay:_display token:token];
}
- (void)startDisplay:(SCDisplay *)display token:(NSUInteger)token {
    @try {
        _engine = [[AVAudioEngine alloc] init]; AVAudioInputNode *input = _engine.inputNode;
        AVAudioFormat *format = [input outputFormatForBus:0];
        if (!format.channelCount || format.channelCount > 8 || format.sampleRate < 8000 || format.sampleRate > 192000) { [self fail:@"MICROPHONE_UNAVAILABLE"]; return; }
        __weak PWCapture *weak = self;
        [input installTapOnBus:0 bufferSize:1024 format:format block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) { (void)when; [weak microphone:buffer generation:token]; }]; _tapInstalled = YES;
        _configurationObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioEngineConfigurationChangeNotification object:_engine queue:nil usingBlock:^(NSNotification *notification) { (void)notification; PWCapture *owner = weak; if (owner && owner->_acceptWork.load()) owner->_output->fail(@"MICROPHONE_UNAVAILABLE"); }];
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
        SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
        configuration.capturesAudio = YES; configuration.excludesCurrentProcessAudio = YES;
        configuration.sampleRate = 48000; configuration.channelCount = 2;
        configuration.width = 2; configuration.height = 2; configuration.queueDepth = 3; configuration.showsCursor = NO;
        configuration.minimumFrameInterval = CMTimeMake(1, 1);
        _stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:self];
        _activeStream.store((__bridge void *)_stream);
        NSError *error = nil;
        if (![_stream addStreamOutput:self type:SCStreamOutputTypeAudio sampleHandlerQueue:_samples error:&error]) { [self fail:@"SYSTEM_AUDIO_UNAVAILABLE"]; return; }
        [_engine prepare];
        if (![_engine startAndReturnError:&error]) { [self fail:@"MICROPHONE_UNAVAILABLE"]; return; }
        _phase = PWStarting; [self deadline:10];
        [_stream startCaptureWithCompletionHandler:^(NSError *startError) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (token != self->_generation || self->_phase != PWStarting) return;
                self->_phase = PWRecording;
                if (startError) { [self fail:([startError.domain isEqualToString:SCStreamErrorDomain] && startError.code == SCStreamErrorUserDeclined) ? @"SCREEN_PERMISSION_DENIED" : @"CAPTURE_START_FAILED"]; return; }
                if (self->_wantEnd || self->_wantPaused) { [self beginStop]; return; }
                [self deadline:0]; [self state:@"recording"]; self->_output->setAccepting(true); { std::lock_guard<std::mutex> lock(self->_admission); self->_activeStream.store((__bridge void *)self->_stream); self->_acceptWork.store(true); }
            });
        }];
    } @catch (NSException *exception) { (void)exception; [self fail:@"INTERNAL_ERROR"]; }
}
- (void)stopMicrophone {
    if (_configurationObserver) { [[NSNotificationCenter defaultCenter] removeObserver:_configurationObserver]; _configurationObserver = nil; }
    if (_engine) {
        [_engine stop];
        if (_tapInstalled) { [_engine.inputNode removeTapOnBus:0]; _tapInstalled = NO; }
        _engine = nil;
    }
}
- (void)closeAdmission {
    std::lock_guard<std::mutex> lock(_admission); _acceptWork.store(false); _activeStream.store(nullptr);
}
- (void)closeAudio { [self closeAdmission]; _output->setAccepting(false); }
- (void)beginStop {
    if (_phase == PWEnded) return;
    [self closeAdmission]; [self stopMicrophone];
    if (_phase == PWStarting || _phase == PWStopping) return;
    if (_phase == PWPreparing) ++_generation; // Cancel pending permission/content callbacks.
    _phase = PWStopping; [self deadline:10];
    if (_stream) {
        SCStream *stream = _stream;
        [stream stopCaptureWithCompletionHandler:^(NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (self->_stream != stream) return;
                [stream removeStreamOutput:self type:SCStreamOutputTypeAudio error:NULL]; self->_stream = nil;
                if (error) { self->_wantEnd = YES; self->_failed = YES; self->_phase = PWEnded; ++self->_generation; self->_output->event(@{@"event": @"error", @"code": @"CAPTURE_STOP_FAILED"}); [self deadline:0]; self->_output->finish(1); return; }
                [self drained];
            });
        }];
    } else [self drained];
}
- (void)drained {
    // Normal stop closes new admission first. Deliver every admitted immutable
    // buffer before closing output and acknowledging pause/end. Fatal errors
    // close output immediately and explicitly report the loss instead.
    NSUInteger token = _generation;
    dispatch_async(_work, ^{
        BOOL conversionFailed = NO;
        @try {
            if (self->_output->isAccepting()) {
                if (self->_systemConverter && ![self->_systemConverter finishSource:@"system" output:self->_output]) conversionFailed = YES;
                if (self->_microphoneConverter && ![self->_microphoneConverter finishSource:@"microphone" output:self->_output]) conversionFailed = YES;
            }
        } @catch (NSException *exception) { (void)exception; conversionFailed = YES; }
        self->_systemConverter = nil; self->_microphoneConverter = nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (token != self->_generation || self->_phase != PWStopping) return;
            // An output error queued by the last conversion must precede ended.
            self->_output->deliverError();
            if (conversionFailed) [self fail:@"AUDIO_CONVERSION_FAILED"];
            self->_output->setAccepting(false); [self deadline:0];
            if (self->_wantEnd) { self->_display = nil; self->_prepared = NO; self->_phase = PWEnded; [self state:@"ended"]; self->_output->finish(self->_failed ? 1 : 0); }
            else { self->_phase = PWPaused; [self state:@"paused"]; if (!self->_wantPaused) [self beginStart]; }
        });
    });
}
- (void)microphone:(AVAudioPCMBuffer *)buffer generation:(NSUInteger)token {
    std::lock_guard<std::mutex> admission(_admission);
    if (!_acceptWork.load() || token != _audioGeneration.load()) return;
    if (dispatch_semaphore_wait(_slots, DISPATCH_TIME_NOW) != 0) { _output->fail(@"AUDIO_BACKPRESSURE"); return; }
    @autoreleasepool {
        if (!PWValidBuffer(buffer)) { dispatch_semaphore_signal(_slots); _output->fail(@"AUDIO_CONVERSION_FAILED"); return; }
        AVAudioPCMBuffer *copy = [[AVAudioPCMBuffer alloc] initWithPCMFormat:buffer.format frameCapacity:buffer.frameLength]; copy.frameLength = buffer.frameLength;
        const AudioBufferList *from = buffer.audioBufferList; AudioBufferList *to = copy.mutableAudioBufferList;
        if (!copy || to->mNumberBuffers != from->mNumberBuffers) { dispatch_semaphore_signal(_slots); _output->fail(@"AUDIO_CONVERSION_FAILED"); return; }
        for (UInt32 i = 0; i < from->mNumberBuffers; ++i) {
            if (to->mBuffers[i].mDataByteSize < from->mBuffers[i].mDataByteSize) { dispatch_semaphore_signal(_slots); _output->fail(@"AUDIO_CONVERSION_FAILED"); return; }
            memcpy(to->mBuffers[i].mData, from->mBuffers[i].mData, from->mBuffers[i].mDataByteSize);
        }
        dispatch_async(_work, ^{ @autoreleasepool { @try { if (token == self->_audioGeneration.load()) { if (!self->_microphoneConverter) self->_microphoneConverter = [PWConverter new]; if (![self->_microphoneConverter convert:copy source:@"microphone" output:self->_output]) self->_output->fail(@"AUDIO_CONVERSION_FAILED"); } } @catch (NSException *e) { (void)e; self->_output->fail(@"INTERNAL_ERROR"); } @finally { dispatch_semaphore_signal(self->_slots); } } });
    }
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    std::lock_guard<std::mutex> admission(_admission);
    NSUInteger token = _audioGeneration.load();
    if ((__bridge void *)stream != _activeStream.load() || type != SCStreamOutputTypeAudio || !_acceptWork.load() || !CMSampleBufferDataIsReady(sample)) return;
    CMItemCount frames = CMSampleBufferGetNumSamples(sample);
    if (frames < 1 || frames > kMaxFrames) { _output->fail(@"AUDIO_CONVERSION_FAILED"); return; }
    if (dispatch_semaphore_wait(_slots, DISPATCH_TIME_NOW) != 0) { _output->fail(@"AUDIO_BACKPRESSURE"); return; }
    CFRetain(sample);
    dispatch_async(_work, ^{ @autoreleasepool {
        @try {
            if (token == self->_audioGeneration.load()) {
                const AudioStreamBasicDescription *description = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
                if (!description || description->mFormatID != kAudioFormatLinearPCM || description->mChannelsPerFrame < 1 || description->mChannelsPerFrame > 8 || description->mBytesPerFrame > 64 || description->mSampleRate < 8000 || description->mSampleRate > 192000) self->_output->fail(@"AUDIO_CONVERSION_FAILED");
                else {
                    AVAudioFormat *format = [[AVAudioFormat alloc] initWithStreamDescription:description];
                    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:(AVAudioFrameCount)frames]; buffer.frameLength = (AVAudioFrameCount)frames;
                    if (!buffer || CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, 0, (int32_t)frames, buffer.mutableAudioBufferList) != noErr) self->_output->fail(@"AUDIO_CONVERSION_FAILED");
                    else { if (!self->_systemConverter) self->_systemConverter = [PWConverter new]; if (![self->_systemConverter convert:buffer source:@"system" output:self->_output]) self->_output->fail(@"AUDIO_CONVERSION_FAILED"); }
                }
            }
        } @catch (NSException *e) { (void)e; self->_output->fail(@"INTERNAL_ERROR"); }
        @finally { CFRelease(sample); dispatch_semaphore_signal(self->_slots); }
    } });
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { (void)error; if ((__bridge void *)stream == _activeStream.load()) _output->fail(@"SYSTEM_AUDIO_UNAVAILABLE"); }
@end

#ifndef PW_AUDIO_CONVERTER_FIXTURE
int main(int argc, const char *argv[]) {
    (void)argv;
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN); signal(SIGINT, SIG_IGN); signal(SIGTERM, SIG_IGN);
        auto output = new PWOutput(); PWCapture *capture = [[PWCapture alloc] initWithOutput:output];
        output->onError = [capture](NSString *code) { [capture fail:code]; };
        if (argc != 1) { [capture fail:kProtocolError]; dispatch_main(); }
        int flags = fcntl(STDIN_FILENO, F_GETFL);
        if (flags < 0 || fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) < 0) { [capture fail:kProtocolError]; dispatch_main(); }
        auto input = new std::string(); auto stopped = new bool(false);
        dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(source, ^{
            if (*stopped) return;
            char bytes[4096]; ssize_t n = read(STDIN_FILENO, bytes, sizeof(bytes));
            if (n == 0) { *stopped = true; dispatch_source_cancel(source); if (!input->empty()) [capture fail:kProtocolError]; else [capture stop]; return; }
            if (n < 0) { if (errno != EAGAIN && errno != EINTR) { *stopped = true; dispatch_source_cancel(source); [capture fail:kProtocolError]; } return; }
            for (ssize_t i = 0; i < n; ++i) {
                if (bytes[i] != '\n') { input->push_back(bytes[i]); if (input->size() <= 4096) continue; *stopped = true; [capture fail:kProtocolError]; break; }
                NSData *data = [NSData dataWithBytes:input->data() length:input->size()]; input->clear();
                id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
                if (![value isKindOfClass:[NSDictionary class]] || [value count] != 1 || ![value[@"command"] isKindOfClass:[NSString class]] || ![@[@"prepare", @"start", @"pause", @"resume", @"stop"] containsObject:value[@"command"]]) { *stopped = true; [capture fail:kProtocolError]; break; }
                [capture command:value[@"command"]];
                if ([value[@"command"] isEqualToString:@"stop"]) { *stopped = true; break; }
            }
            if (*stopped) dispatch_source_cancel(source);
        }); dispatch_resume(source);
        static NSMutableArray *signals = [NSMutableArray array];
        for (int number : {SIGINT, SIGTERM}) {
            dispatch_source_t termination = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, number, 0, dispatch_get_main_queue());
            [signals addObject:termination];
            dispatch_source_set_event_handler(termination, ^{ *stopped = true; dispatch_source_cancel(source); [capture stop]; }); dispatch_resume(termination);
        }
        dispatch_main();
    }
}
#endif
