import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import * as mediasoupClient from 'mediasoup-client';

@Component({
  selector: 'app-video-chat',
  imports: [],
  templateUrl: './video-chat.component.html',
  standalone: true,
  styleUrl: './video-chat.component.css'
})
export class VideoChatComponent implements OnInit {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;

  private device: mediasoupClient.Device | null = null;
  private producerTransport: mediasoupClient.types.Transport | null = null;
  private socket: WebSocket | null = null;
  private messageQueue: string[] = []; // Hàng đợi cho messages

  ngOnInit() {}

  async start() {
    // Kết nối WebSocket
    this.socket = new WebSocket('ws://localhost:3001');

    this.socket.onopen = () => {
      console.log('WebSocket connected');
      // Gửi tất cả messages trong queue khi kết nối mở
      while (this.messageQueue.length > 0) {
        this.socket!.send(this.messageQueue.shift()!);
      }
    };
    this.socket.onmessage = (event) => this.handleServerMessage(event.data);
    this.socket.onerror = (error) => console.error('WebSocket error:', error);
    this.socket.onclose = () => console.log('WebSocket disconnected');

    // Khởi tạo mediasoup device
    this.device = new mediasoupClient.Device();

    // Yêu cầu router RTP capabilities (thêm vào queue nếu chưa kết nối)
    this.sendMessage(JSON.stringify({ type: 'getRouterRtpCapabilities' }));

    // Lấy stream từ webcam
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    this.localVideo.nativeElement.srcObject = stream;
  }

  private sendMessage(message: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(message);
    } else {
      // Thêm vào queue nếu WebSocket chưa mở
      this.messageQueue.push(message);
    }
  }

  async handleServerMessage(data: string) {
    const message = JSON.parse(data);
    switch (message.type) {
      case 'routerRtpCapabilities':
        await this.device!.load({ routerRtpCapabilities: message.data });
        this.sendMessage(JSON.stringify({ type: 'createProducerTransport' }));
        break;
      case 'producerTransportCreated':
        this.producerTransport = this.device!.createSendTransport(message.data);
        this.producerTransport.on('connect', async ({ dtlsParameters }, callback) => {
          this.sendMessage(JSON.stringify({ type: 'connectProducerTransport', dtlsParameters }));
          callback();
        });
        this.producerTransport.on('produce', async ({ kind, rtpParameters }, callback) => {
          this.sendMessage(JSON.stringify({ type: 'produce', kind, rtpParameters }));
          callback({ id: 'dummy-id' });
        });
        // Sản xuất media
        const stream = this.localVideo.nativeElement.srcObject as MediaStream;
        const tracks = stream.getTracks();
        for (const track of tracks) {
          await this.producerTransport.produce({ track });
        }
        break;
    }
  }

  stop() {
    if (this.producerTransport) this.producerTransport.close();
    if (this.socket) this.socket.close();
    this.messageQueue = []; // Xóa queue
    this.localVideo.nativeElement.srcObject = null;
    this.remoteVideo.nativeElement.srcObject = null;
  }
}
