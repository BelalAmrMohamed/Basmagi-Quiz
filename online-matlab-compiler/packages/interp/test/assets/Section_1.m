% Image Processing Levels :-
% 1) Low level processing (Image Processing) :-
%       Input: Image , Output: Image , Ex: Noise removal, 
%             Image sharpening.
% 2) Mid level processing (Image Analysis) :-
%       Input: Image , Output: Attributes , Ex: Object recognition, 
%             Segmentation, Optical Character recognition (OCR).
% 3) High level processing (Computer Vision) :-
%       Input: Image , Output: Understanding , Ex: Scene understanding, 
%             Autonomous navigation.
% -------------------------------------------------------------------------
% Image Representations (Types) :=> (Binary , Grayscale , RGB Color) :-
% 1) Binary Image (1 bit for pixel)(0 or 1).
% 2) Grayscale Image (8 bit for pixel)(0..255).
% 3) RGB Image (3*8 bit for pixel).
% -------------------------------------------------------------------------
% Dealing with MATLAB interface:
% 	Command Window.
% 	Workspace: (show variables & values of variables).
% 	Command History.
% 	Current Folder.
% 	Editor (Script).
% -------------------------------------------------------------------------
% Methods of writing code in MATLAB:
% 1) Command Window (differ between code with ; and without).
%     (For Images: without ; print matrix of image in command window).
% 2) Script (then run the script).
% 3) Function (call the function).
% -------------------------------------------------------------------------
% Useful MATLAB Functions to mention:
% 	imread, imshow, imtool, imfinfo, imwrite, rgb2gray, 
%   im2double, imresize, imrotate, imcrop, imhist, histeq.
% 	clear: to clean workspace.
% 	clc: clean or delete command window.
% 	Other Commands: who , whos , help , lookfor , doc , size(For Images).
% -------------------------------------------------------------------------
% Section_1 :-
% -------------------------------------------------------------------------
% Reading Image :-
% Reading Image by using imread('imagename /OR/ full path of image') :-
% x = imread("D:\LD-D\MY SECTIONS\SECTIONS\10\Ahlya (Image Processing)\NEW\Sections\Section 1\test.png");
% x = imread('test.png');
% y = imread('testgray.png');
% -------------------------------------------------------------------------
% Showing Image :-
% imshow(a);
% imshow(y);
% -------------------------------------------------------------------------
% Showing more than one image (In One Time) :-
% You should add figure then after it add: ( nothing /OR/ , /OR/ ; ).
% imshow(x);
% figure,
% imshow(y);
% -------------------------------------------------------------------------
% Showing more than one image (In One Time - In One Line) :-
% imshow(x), figure, imshow(y);
% -------------------------------------------------------------------------
% Showing image using other method :-
% (Inspect Pixel Values - pixel region window).
% imtool(x);
% imtool(y);
% -------------------------------------------------------------------------
% Printing the Size of the Image :-
% size(x)
% size(y)
% -------------------------------------------------------------------------
% Get Information about the Image :-
% imfinfo('test.png')
% imfinfo('testgray.png')
% -------------------------------------------------------------------------
% Writing (Saving) Image :-
% imwrite(x, 'newTest.png');
% imwrite(y, 'newTestGray.png');
% -------------------------------------------------------------------------
