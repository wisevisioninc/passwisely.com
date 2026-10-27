// Offline fixture includes the exact production converter/output owner; never opens capture devices.
#define PW_AUDIO_CONVERTER_FIXTURE 1
#include "../../electron/native/PassWiselyAudioHelper.mm"
@interface PWCapture (TailFixture)
- (void)admittedTailFixture;
@end
@implementation PWCapture (TailFixture)
- (void)admittedTailFixture {
    // Simulate a ready session without constructing either capture device. Both
    // real production ingress methods enqueue synthetic immutable PCM buffers.
    _phase = PWRecording; _generation = 7; _audioGeneration.store(7);
    _acceptWork.store(true); _output->setAccepting(true); [self state:@"recording"];
    AVAudioFormat *format = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
    AVAudioPCMBuffer *buffer = [[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:1600]; buffer.frameLength = 1600;
    for (int i = 0; i < 1600; ++i) buffer.int16ChannelData[0][i] = (int16_t)(i % 101 - 50);
    dispatch_semaphore_t release = dispatch_semaphore_create(0);
    dispatch_async(_work, ^{ dispatch_semaphore_wait(release, DISPATCH_TIME_FOREVER); });
    [self microphone:buffer generation:7];
    AVAudioFormat *systemFormat = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:48000 channels:2 interleaved:YES];
    AVAudioPCMBuffer *system = [[AVAudioPCMBuffer alloc] initWithPCMFormat:systemFormat frameCapacity:4800]; system.frameLength = 4800;
    for (int i = 0; i < 4800; ++i) for (int channel = 0; channel < 2; ++channel) system.floatChannelData[0][i * 2 + channel] = i < 4650 ? 0.25 : 0.75;
    CMAudioFormatDescriptionRef description = NULL; CMBlockBufferRef block = NULL; CMSampleBufferRef sample = NULL;
    OSStatus status = CMAudioFormatDescriptionCreate(kCFAllocatorDefault, systemFormat.streamDescription, 0, NULL, 0, NULL, NULL, &description);
    if (!status) status = CMBlockBufferCreateWithMemoryBlock(kCFAllocatorDefault, NULL, 38400, kCFAllocatorDefault, NULL, 0, 38400, 0, &block);
    if (!status) status = CMBlockBufferReplaceDataBytes(system.floatChannelData[0], block, 0, 38400);
    CMSampleTimingInfo timing = {CMTimeMake(1, 48000), kCMTimeZero, kCMTimeInvalid}; size_t size = 8;
    if (!status) status = CMSampleBufferCreateReady(kCFAllocatorDefault, block, description, 4800, 1, &timing, 1, &size, &sample);
    if (status) exit(4);
    // The callback uses this stand-in only as an identity; no SCStream API runs.
    SCStream *identity = (SCStream *)[NSObject new]; _activeStream.store((__bridge void *)identity);
    [self stream:identity didOutputSampleBuffer:sample ofType:SCStreamOutputTypeAudio];
    CFRelease(sample); CFRelease(block); CFRelease(description);
    [self stop]; // Close admission while the two audio blocks are still queued.
    dispatch_semaphore_signal(release);
}
@end
@interface PWPreparedFixture : PWCapture @end
@implementation PWPreparedFixture
- (void)microphonePermission:(void (^)(BOOL))completion { completion(YES); }
- (void)screenPermission:(void (^)(BOOL))completion { completion(YES); }
- (void)displayForCapture:(void (^)(SCDisplay *, NSString *))completion { completion((SCDisplay *)[NSObject new], nil); }
- (void)prepared { [super prepared]; [self stop]; }
@end
@interface PWMicrophoneDeniedFixture : PWPreparedFixture @end
@implementation PWMicrophoneDeniedFixture
- (void)microphonePermission:(void (^)(BOOL))completion { completion(NO); }
@end
@interface PWScreenDeniedFixture : PWPreparedFixture @end
@implementation PWScreenDeniedFixture
- (void)screenPermission:(void (^)(BOOL))completion { completion(NO); }
@end
@interface PWPendingPreparationFixture : PWPreparedFixture @end
@implementation PWPendingPreparationFixture
- (void)screenPermission:(void (^)(BOOL))completion { [self stop]; completion(YES); }
@end
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN);
        auto output = new PWOutput();
        output->onError = [output](NSString *code) { output->event(@{@"event": @"error", @"code": code}); output->finish(1); };
        output->setAccepting(true);
        if (argc == 2 && strncmp(argv[1], "prepare", 7) == 0) {
            Class type = strcmp(argv[1], "prepare-microphone-denied") == 0 ? [PWMicrophoneDeniedFixture class] : strcmp(argv[1], "prepare-screen-denied") == 0 ? [PWScreenDeniedFixture class] : strcmp(argv[1], "prepare-stop") == 0 ? [PWPendingPreparationFixture class] : [PWPreparedFixture class];
            PWCapture *capture = [[type alloc] initWithOutput:output];
            output->onError = [capture](NSString *code) { [capture fail:code]; };
            [capture command:@"prepare"];
            dispatch_main();
        }
        if (argc == 2 && strcmp(argv[1], "tail") == 0) {
            PWCapture *capture = [[PWCapture alloc] initWithOutput:output];
            output->onError = [capture](NSString *code) { [capture fail:code]; };
            [capture admittedTailFixture]; dispatch_main();
        }
        if (argc == 2 && strcmp(argv[1], "overload") == 0) {
            NSData *bytes = [NSMutableData dataWithLength:3200]; NSString *base64 = [bytes base64EncodedStringWithOptions:0];
            for (int i = 0; i < 1000; ++i) output->event(@{@"event": @"audio", @"source": @"system", @"audio": base64}, true);
        } else {
            BOOL switching = argc == 2 && strcmp(argv[1], "format-switch") == 0;
            AVAudioFormat *stereo = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:48000 channels:2 interleaved:NO];
            AVAudioPCMBuffer *system = [[AVAudioPCMBuffer alloc] initWithPCMFormat:stereo frameCapacity:4800]; system.frameLength = 4800;
            for (int i = 0; i < 4800; ++i) { system.floatChannelData[0][i] = system.floatChannelData[1][i] = switching && i >= 4650 ? 0.75 : 0.25; }
            PWConverter *converter = [PWConverter new];
            for (int block = 0; block < (switching ? 1 : 20); ++block) if (![converter convert:system source:@"system" output:output]) return 2;
            AVAudioFormat *mono = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:16000 channels:1 interleaved:YES];
            AVAudioPCMBuffer *microphone = [[AVAudioPCMBuffer alloc] initWithPCMFormat:mono frameCapacity:1600]; microphone.frameLength = 1600;
            for (int i = 0; i < 1600; ++i) microphone.int16ChannelData[0][i] = (int16_t)(i % 101 - 50);
            if (!switching) converter = [PWConverter new];
            if (![converter convert:microphone source:switching ? @"system" : @"microphone" output:output]) return 3;
            if (switching && ![converter finishSource:@"system" output:output]) return 5;
            output->finish(0);
        }
        dispatch_main();
    }
}
